package dev.getmilano.sample.desktop.environment

import dev.getmilano.MilanoAction
import dev.getmilano.MilanoActionFailure
import dev.getmilano.MilanoActionHandler
import dev.getmilano.MilanoEngine
import dev.getmilano.MilanoFunctionCall
import dev.getmilano.MilanoFunctionHandler
import dev.getmilano.MilanoObserver
import dev.getmilano.MilanoUnknownTypePolicy
import dev.getmilano.MilanoUserInteractionObserver
import dev.getmilano.MilanoValue
import dev.getmilano.MilanoViewBuilder
import dev.getmilano.sample.desktop.milanobridge.ExamplesAction
import dev.getmilano.sample.desktop.milanobridge.ExamplesVocabulary
import dev.getmilano.sample.desktop.milanobridge.NavigateScreen
import dev.getmilano.sample.desktop.milanobridge.SubmitContactFailure
import dev.getmilano.sample.desktop.milanobridge.milanoRegistry
import dev.getmilano.sample.desktop.ui.Screen
import dev.getmilano.synthesizedState
import dev.getmilano.viewBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.awt.Desktop
import java.net.URI

private const val SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork"

/**
 * The sample's Milano setup: one engine, the design system registered,
 * builders per screen. Screens depend on this service, never on engine
 * internals.
 *
 * No dispatcher is configured anywhere: on the desktop JVM the engine's
 * default is bound to the AWT event thread, where Compose runs, which is
 * the same guarantee MilanoMainDispatcher gives on Android.
 */
class SampleEnvironment {
    /** Logs every occurrence the engine reports: the sample's telemetry. */
    private val observer =
        MilanoObserver { occurrence ->
            println("milano: ${occurrence.kind} view=${occurrence.viewIdentity} node=${occurrence.node ?: "-"}")
        }

    /**
     * The sample's analytics sink: a real app would forward each record to
     * its tracker; the sample logs it. Milano implements no tracker.
     */
    private val analytics =
        MilanoUserInteractionObserver { interaction ->
            println(
                "analytics: ${interaction.kind} view=${interaction.viewIdentity}" +
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
            vocabularyJson = document("vocabulary"),
            registry = milanoRegistry(),
            observer = observer,
            userInteractionObserver = analytics,
            functionHandler = MilanoFunctionHandler { call -> hostFunction(call) },
        ).also { ExamplesVocabulary.assertMatches(it) }
    }

    /**
     * The host functions the vocabulary declares, answered here: pure over
     * their arguments, so the engine may ask as often as it likes. A real
     * app formats with its own locale services; the sample formats in a
     * fixed shape so every platform shows the same string.
     */
    private fun hostFunction(call: MilanoFunctionCall): MilanoValue? =
        when (call.name) {
            "formatMoney" -> {
                val first = call.arguments.getOrNull(0)
                val amount = first?.doubleOrNull ?: first?.intOrNull?.toDouble() ?: 0.0
                val currency = call.arguments.getOrNull(1)?.stringOrNull ?: "EUR"
                MilanoValue.StringValue(String.format(java.util.Locale.ROOT, "%.2f %s", amount, currency))
            }

            else -> {
                null
            }
        }

    /** The single async funnel: navigation and submission live in the host. */
    private val handler = MilanoActionHandler { action -> handle(action) }

    fun builder(screen: Screen): MilanoViewBuilder =
        when (screen) {
            Screen.FORM -> formBuilder()
            Screen.CATALOG -> catalogBuilder()
            else -> documentBuilder(screen.key)
        }

    /**
     * The interstitial: the document's `dismiss` action is interpreted by
     * the presenting screen; every other action takes the shared path.
     */
    fun interstitialBuilder(onDismiss: () -> Unit): MilanoViewBuilder =
        engine
            .viewBuilder(document("interstitial"))
            .context(sharedContext)
            .actionHandler { action ->
                if (ExamplesAction.from(action) is ExamplesAction.Dismiss) {
                    withContext(Dispatchers.Main) { onDismiss() }
                    null
                } else {
                    handle(action)
                }
            }.label("interstitial")

    /**
     * The card detail: the numbers are context, and the document does the
     * masking with the contract's string functions rather than receiving
     * a pre-masked string. Nothing sensitive is computed here, and the
     * reveal is state the document sets while the control is held.
     */
    fun cardDetailBuilder(): MilanoViewBuilder =
        documentBuilder(
            "card-detail",
            mapOf(
                "cardNumber" to MilanoValue.StringValue("4111111111111111"),
                "cardHolder" to MilanoValue.StringValue("Ada Lovelace"),
                "expiry" to MilanoValue.StringValue("0929"),
                "cvv" to MilanoValue.StringValue("123"),
                "capabilities" to MilanoValue.StringValue("Contactless, Online, ATM"),
                "cardStatus" to MilanoValue.StringValue("frozen"),
                "statusLabels" to
                    MilanoValue.RecordValue(
                        mapOf(
                            "active" to MilanoValue.StringValue("Active"),
                            "frozen" to MilanoValue.StringValue("Frozen"),
                            "expired" to MilanoValue.StringValue("Expired"),
                        ),
                    ),
            ),
        )

    /**
     * The quick actions strip: one `$repeat` of tiles whose tap records
     * the tapped position and then asks the host to open a screen.
     * `navigate` is interpreted by the presenting screen, as `dismiss`
     * is; everything else takes the shared path, so the analytics `track`
     * is handled once for the whole sample.
     */
    fun quickActionsBuilder(onNavigate: (NavigateScreen) -> Unit): MilanoViewBuilder =
        engine
            .viewBuilder(document("quick-actions"))
            .context(sharedContext)
            .stateDataProvider {
                mapOf(
                    "actions" to MilanoValue.ArrayValue(quickActions),
                    "lastTapped" to MilanoValue.IntValue(-1L),
                )
            }.actionHandler { action ->
                val decoded = ExamplesAction.from(action)
                if (decoded is ExamplesAction.Navigate) {
                    withContext(Dispatchers.Main) { onNavigate(decoded.screen) }
                    null
                } else {
                    handle(action)
                }
            }.label("quick-actions")

    /**
     * What the quick actions service answers: the strip is data, so the
     * app decides which shortcuts it offers today without shipping a new
     * document.
     */
    private val quickActions: List<MilanoValue> =
        listOf(
            quickAction("profile", "Profile", icon = "person", screen = "profile"),
            quickAction("catalog", "Catalog", icon = "list", screen = "catalog"),
            quickAction("pokemon", "Pokemon", icon = "search", screen = "pokemon"),
            quickAction("contact", "Contact", icon = "edit", screen = "form"),
        )

    private fun quickAction(
        id: String,
        label: String,
        icon: String,
        screen: String,
    ): MilanoValue =
        MilanoValue.RecordValue(
            mapOf(
                "id" to MilanoValue.StringValue(id),
                "label" to MilanoValue.StringValue(label),
                // `icon` and `screen` are declared as enums in the
                // document's state, so a value outside the declared
                // members is refused at the build boundary instead of
                // reaching a renderer as an icon nobody draws.
                "icon" to MilanoValue.StringValue(icon),
                "screen" to MilanoValue.StringValue(screen),
            ),
        )

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
     * The catalog: one `$repeat` over `state.items`, so the document is the
     * template and the list is data the state data provider supplies, here
     * as a catalog service would answer.
     */
    fun catalogBuilder(): MilanoViewBuilder =
        engine
            .viewBuilder(document("catalog"))
            .context(sharedContext)
            .stateDataProvider { mapOf("items" to MilanoValue.ArrayValue(catalogItems), "hidden" to MilanoValue.IntValue(0L)) }
            .actionHandler(handler)
            .label("catalog")

    /**
     * What the catalog service answers: one record per item, in the shape
     * the document declares for `items`.
     */
    private val catalogItems: List<MilanoValue> =
        listOf(
            catalogItem("Bulbasaur", "Grass and poison. Loves the sun.", sprite = 1, slug = "bulbasaur"),
            catalogItem("Charmander", "Fire type. Keep it dry.", sprite = 4, slug = "charmander"),
            catalogItem("Squirtle", "Water type. Shell first.", sprite = 7, slug = "squirtle"),
            catalogItem("Pikachu", "Electric type. The famous one.", sprite = 25, slug = "pikachu"),
        )

    private fun catalogItem(
        name: String,
        blurb: String,
        sprite: Int,
        slug: String,
    ): MilanoValue =
        MilanoValue.RecordValue(
            mapOf(
                // The `id` is what the document keys its `$repeat` on, so an
                // item keeps its identity when the list is reordered.
                "id" to MilanoValue.StringValue(slug),
                "name" to MilanoValue.StringValue(name),
                "blurb" to MilanoValue.StringValue(blurb),
                "imageUrl" to MilanoValue.StringValue("$SPRITES/$sprite.png"),
                "url" to MilanoValue.StringValue("https://www.pokemon.com/us/pokedex/$slug"),
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
            .viewBuilder(document(resource))
            .apply {
                // Banners are optional, promotional surfaces: an unknown
                // component degrades to a gap instead of failing the build.
                // The form and the interstitial keep the fail default.
                if (resource.startsWith("banner")) unknownTypePolicy(MilanoUnknownTypePolicy.SKIP)
            }.context(sharedContext + screenContext)
            .stateDataProvider { declarations -> synthesizedState(declarations) }
            .actionHandler(handler)
            .label(resource)

    /**
     * The form: initial values arrive through the async state data
     * provider, as if fetched from an API.
     */
    private fun formBuilder(): MilanoViewBuilder =
        engine
            .viewBuilder(document("contact-form"))
            .context(sharedContext)
            .stateDataProvider { declarations ->
                delay(700)
                synthesizedState(declarations)
            }.actionHandler(handler)
            .label("contact-form")

    /**
     * The returned value is the completion result: submitContact declares
     * result "string", so its confirmation number flows back into the
     * document's onSuccess actions as the result root; a thrown
     * [MilanoActionFailure] carries the declared failure payload back as
     * the failure root. Every action arrives with its dispatch identity,
     * the idempotency key a real handler would send with its request.
     */
    private suspend fun handle(action: MilanoAction): MilanoValue? {
        // Generated bindings make the dispatch typed and exhaustive.
        when (val decoded = ExamplesAction.from(action)) {
            is ExamplesAction.OpenUrl -> {
                // The handler is the last capability check (state and actions
                // spec): the gate proved `url` is a string, not that it is
                // safe to open. Only https with a host leaves the app; a real
                // app narrows this to its own hosts. Throwing fails the
                // completion, so a document that binds onFailure hears it.
                val uri = URI(decoded.url)
                require(uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrEmpty()) {
                    "refused url ${decoded.url}: only https with a host is opened"
                }
                withContext(Dispatchers.IO) { Desktop.getDesktop().browse(uri) }
            }

            is ExamplesAction.SubmitContact -> {
                // Simulated network call; the returned confirmation number
                // is what a real backend would answer with. The failure
                // payload is the declared enum: the document decides what to
                // tell the user. A plain exception would be an invalid
                // completion against the non-optional declaration, so every
                // failure is mapped here.
                println("sample: submitting ${decoded.name} ${decoded.surname} <${decoded.email}> dispatch ${action.dispatchId}")
                delay(1_000)
                if (decoded.email.endsWith(".invalid")) {
                    throw MilanoActionFailure(MilanoValue.StringValue(SubmitContactFailure.InvalidEmail.value))
                }
                if (decoded.email.startsWith("offline")) {
                    throw MilanoActionFailure(MilanoValue.StringValue(SubmitContactFailure.Unavailable.value))
                }
                return MilanoValue.StringValue("MC-${java.util.UUID.randomUUID().toString().take(6)}")
            }

            is ExamplesAction.Track -> {
                // Two sources, one sink: the interstitial's lifecycle
                // bindings report an impression, the quick actions strip
                // reports a tap with its position. `position` is optional,
                // so an impression has none and a tap on the third tile
                // reports 2. The document supplies it from the repeat's
                // index binding; nothing here counts.
                val suffix = decoded.position?.let { " position $it" } ?: ""
                println("sample: ${decoded.surface} ${decoded.event.value}$suffix")
            }

            is ExamplesAction.Dismiss -> {
                // Interpreted by the presenting screen's handler; inert here.
            }

            is ExamplesAction.Navigate -> {
                // Interpreted by the presenting screen's handler; inert here.
            }

            is ExamplesAction.Unrecognized -> {
                println("sample: unhandled action ${decoded.action.name}")
            }
        }
        return null
    }

    /** A bundled document, loaded as text: `int` and `double` survive only as text. */
    private fun document(name: String): String =
        checkNotNull(SampleEnvironment::class.java.getResourceAsStream("/documents/$name.json")) {
            "missing bundled document $name.json"
        }.bufferedReader().use { it.readText() }
}
