package dev.getmilano.sample.environment

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import dev.getmilano.MilanoAction
import dev.getmilano.MilanoActionHandler
import dev.getmilano.MilanoEngine
import dev.getmilano.MilanoMainDispatcher
import dev.getmilano.MilanoObserver
import dev.getmilano.MilanoType
import dev.getmilano.MilanoUnknownTypePolicy
import dev.getmilano.MilanoUserInteractionObserver
import dev.getmilano.MilanoValue
import dev.getmilano.MilanoViewBuilder
import dev.getmilano.sample.milanobridge.ExamplesAction
import dev.getmilano.sample.milanobridge.ExamplesVocabulary
import dev.getmilano.sample.milanobridge.milanoRegistry
import dev.getmilano.sample.ui.Screen
import dev.getmilano.viewBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * The sample's Milano setup: one engine, the design system registered,
 * builders per screen. Screens depend on this service, never on engine
 * internals.
 */
class SampleEnvironment(
    private val context: Context,
) {
    /** Logs every occurrence the engine reports: the sample's telemetry. */
    private val observer =
        MilanoObserver { occurrence ->
            Log.d("milano", "${occurrence.kind} view=${occurrence.viewIdentity} node=${occurrence.node ?: "-"}")
        }

    /**
     * The sample's analytics sink: a real app would forward each record to
     * its tracker; the sample logs it. Milano implements no tracker.
     */
    private val analytics =
        MilanoUserInteractionObserver { interaction ->
            Log.d(
                "analytics",
                "${interaction.kind} view=${interaction.viewIdentity}" +
                    " node=${interaction.node ?: "-"} name=${interaction.name ?: "-"}",
            )
        }

    /**
     * One shared context for every screen: each document reads only the
     * keys it declares; the rest are ignored by rule.
     */
    private val sharedContext =
        mapOf(
            "userName" to MilanoValue.StringValue("Ada"),
            "marketingConsentRequired" to MilanoValue.BoolValue(true),
        )

    private val engine: MilanoEngine by lazy {
        // The engine keeps the contract default: unknown types fail the
        // build. Surfaces that can degrade gracefully opt into skip below.
        MilanoEngine(
            vocabularyJson = asset("vocabulary.json"),
            registry = milanoRegistry(),
            observer = observer,
            userInteractionObserver = analytics,
        ).also { ExamplesVocabulary.assertMatches(it) }
    }

    /** The single async funnel: navigation and submission live in the host. */
    private val handler = MilanoActionHandler { action -> handle(action) }

    fun builder(screen: Screen): MilanoViewBuilder =
        when (screen) {
            Screen.FORM -> formBuilder()
            else -> documentBuilder(screen.key)
        }

    /**
     * The interstitial: the document's `dismiss` action is interpreted by
     * the presenting screen; every other action takes the shared path.
     */
    fun interstitialBuilder(onDismiss: () -> Unit): MilanoViewBuilder =
        engine
            .viewBuilder(asset("interstitial.json"))
            .context(sharedContext)
            .actionHandler { action ->
                if (ExamplesAction.from(action) is ExamplesAction.Dismiss) {
                    withContext(Dispatchers.Main) { onDismiss() }
                    null
                } else {
                    handle(action)
                }
            }.dispatcher(MilanoMainDispatcher())
            .label("interstitial")

    /**
     * The Pokemon demo: the screen fetches its own values first, then adds
     * them on top of the shared context for this one host.
     */
    fun pokemonBuilder(screenContext: Map<String, MilanoValue>): MilanoViewBuilder = documentBuilder("pokemon", screenContext)

    /**
     * The profile screen: identity values a real app would fetch from its
     * account service, injected as screen context over the shared context.
     */
    fun profileBuilder(): MilanoViewBuilder =
        documentBuilder(
            "profile",
            mapOf(
                "memberSince" to MilanoValue.StringValue("March 2024"),
                "avatarUrl" to
                    MilanoValue.StringValue(
                        "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png",
                    ),
            ),
        )

    /**
     * Self-contained documents (banners, the expression demos): context
     * injected; any declared state gets instant defaults. A screen may add
     * its own context values on top of the shared ones; on a key collision
     * the screen wins.
     */
    private fun documentBuilder(
        resource: String,
        screenContext: Map<String, MilanoValue> = emptyMap(),
    ): MilanoViewBuilder =
        engine
            .viewBuilder(asset("$resource.json"))
            .apply {
                // Banners are optional, promotional surfaces: an unknown
                // component degrades to a gap instead of failing the build.
                // The form and the interstitial keep the fail default.
                if (resource.startsWith("banner")) unknownTypePolicy(MilanoUnknownTypePolicy.SKIP)
            }.context(sharedContext + screenContext)
            .stateDataProvider { declarations -> defaults(declarations) }
            .actionHandler(handler)
            .dispatcher(MilanoMainDispatcher())
            .label(resource)

    /**
     * The form: initial values arrive through the async state data
     * provider, as if fetched from an API.
     */
    private fun formBuilder(): MilanoViewBuilder =
        engine
            .viewBuilder(asset("contact-form.json"))
            .context(sharedContext)
            .stateDataProvider { declarations ->
                delay(700)
                defaults(declarations)
            }.actionHandler(handler)
            .dispatcher(MilanoMainDispatcher())
            .label("contact-form")

    private fun defaults(declarations: Map<String, MilanoType>): Map<String, MilanoValue> =
        declarations.mapValues { (_, type) ->
            when {
                type.optional -> MilanoValue.Null
                type.kind is MilanoType.Kind.Bool -> MilanoValue.BoolValue(false)
                type.kind is MilanoType.Kind.Int -> MilanoValue.IntValue(0)
                type.kind is MilanoType.Kind.Double -> MilanoValue.DoubleValue(0.0)
                else -> MilanoValue.StringValue("")
            }
        }

    /**
     * The returned value is the completion result: submitContact declares
     * result "string", so its confirmation number flows back into the
     * document's onSuccess actions as the result root.
     */
    private suspend fun handle(action: MilanoAction): MilanoValue? {
        // Generated bindings make the dispatch typed and exhaustive.
        when (val decoded = ExamplesAction.from(action)) {
            is ExamplesAction.OpenUrl -> {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(decoded.url))
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            }

            is ExamplesAction.SubmitContact -> {
                // Simulated network call; the returned confirmation number
                // is what a real backend would answer with.
                Log.d("sample", "submitting ${decoded.name} ${decoded.surname} <${decoded.email}>")
                delay(1_000)
                return MilanoValue.StringValue("MC-${java.util.UUID.randomUUID().toString().take(6)}")
            }

            is ExamplesAction.Dismiss -> {
                // Interpreted by the presenting screen's handler; inert here.
            }

            is ExamplesAction.Unrecognized -> {
                Log.d("sample", "unhandled action ${decoded.action.name}")
            }
        }
        return null
    }

    private fun asset(name: String): String =
        context.assets
            .open(name)
            .bufferedReader()
            .use { it.readText() }
}
