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
import dev.getmilano.MilanoValue
import dev.getmilano.MilanoViewBuilder
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
     * One shared context for every screen: each document reads only the
     * keys it declares; the rest are ignored by rule.
     */
    private val sharedContext =
        mapOf(
            "userName" to MilanoValue.StringValue("Ada"),
            "marketingConsentRequired" to MilanoValue.BoolValue(true),
        )

    private val engine: MilanoEngine by lazy {
        MilanoEngine(
            vocabularyJson = asset("vocabulary.json"),
            registry = milanoRegistry(),
            defaultUnknownTypePolicy = MilanoUnknownTypePolicy.SKIP,
            observer = observer,
        )
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
                if (action.name == "dismiss") {
                    withContext(Dispatchers.Main) { onDismiss() }
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
            .context(sharedContext + screenContext)
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

    private suspend fun handle(action: MilanoAction) {
        when (action.name) {
            "openUrl" -> {
                val url = action.parameters["url"]?.stringOrNull ?: return
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
            }

            "submitContact" -> {
                // Simulated network call; returning normally completes with
                // success, which runs the document's onSuccess actions.
                Log.d("sample", "submitting ${action.parameters}")
                delay(1_000)
            }

            else -> {
                Log.d("sample", "unhandled action ${action.name}")
            }
        }
    }

    private fun asset(name: String): String =
        context.assets
            .open(name)
            .bufferedReader()
            .use { it.readText() }
}
