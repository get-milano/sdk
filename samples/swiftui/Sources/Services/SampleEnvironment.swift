import Foundation
import MilanoSDK

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

/// What the sample's action funnel refuses. A rejected action completes
/// with failure, so a document that binds `onFailure` hears about it.
enum SampleError: Error {
    case refusedUrl(String)
}

/// The sample's Milano setup: one engine, the design system registered,
/// builders per screen. Screens depend on this service, never on engine
/// internals.
final class SampleEnvironment {
    static let shared = SampleEnvironment()

    private let observer = ConsoleObserver()
    private let analytics = ConsoleAnalytics()
    private let engine: MilanoEngine

    private init() {
        do {
            // The engine keeps the contract default: unknown types fail the
            // build. Surfaces that can degrade gracefully opt into skip below.
            engine = try MilanoEngine(
                vocabularyJSON: Self.resource("vocabulary"),
                registry: MilanoBridge.registry(),
                observer: observer,
                userInteractionObserver: analytics,
                functionHandler: MilanoClosureFunctionHandler(Self.hostFunction))
            SampleVocabulary.assertMatches(engine)
        } catch {
            fatalError("Milano engine setup failed: \(error)")
        }
    }

    /// The host functions the vocabulary declares, answered here: pure
    /// over their arguments, so the engine may ask as often as it likes.
    /// A real app formats with its own locale services; the sample formats
    /// in a fixed shape so every platform shows the same string. An answer
    /// the declaration does not accept is an invalid function result: the
    /// engine reports it and stands in the zero value of the return type.
    @Sendable private static func hostFunction(_ call: MilanoFunctionCall) -> MilanoValue {
        switch call.name {
        case "formatMoney":
            // Gate-guaranteed by the declaration `[double, string] ->
            // string`; the fallbacks keep the handler total anyway.
            let first = call.arguments.first
            let amount = first?.doubleValue ?? first?.intValue.map(Double.init) ?? 0
            let currency = call.arguments.dropFirst().first?.stringValue ?? "EUR"
            return .string(String(format: "%.2f %@", locale: Self.moneyLocale, amount, currency))
        default:
            return .null
        }
    }

    /// Fixed, so the formatted amount reads the same on every device.
    private static let moneyLocale = Locale(identifier: "en_US_POSIX")

    /// One shared context for every screen: each document reads only the
    /// keys it declares; the rest are ignored by rule.
    private static let sharedContext: [String: MilanoValue] = [
        "userName": .string("Ada"),
        "marketingConsentRequired": .bool(true)
    ]

    /// Self-contained documents (banners, the tip calculator): context
    /// injected; any declared state gets instant defaults. A screen may add
    /// its own context values on top of the shared ones (the Pokemon demo
    /// injects what it fetched); on a key collision the screen wins.
    func documentBuilder(
        resource: String, screenContext: [String: MilanoValue] = [:]
    ) -> MilanoViewBuilder {
        // Banners are optional, promotional surfaces: an unknown component
        // degrades to a gap instead of failing the build. The form and the
        // interstitial keep the fail default; their content is load-bearing.
        let builder = engine.viewBuilder(document: Self.resource(resource))
        if resource.hasPrefix("banner") {
            builder.unknownTypePolicy(.skip)
        }
        return builder
            .context(Self.sharedContext.merging(screenContext) { _, screen in screen })
            .stateData { declarations in MilanoQuickStart.synthesizedState(for: declarations) }
            .actionHandler(Self.handle(_:))
            .label(resource)
    }

    /// The catalog: one `$repeat` over `state.items`, so the document is the
    /// template and the list is data the state data provider supplies, here
    /// as a catalog service would answer. `hidden` is the counter the
    /// document's `watch` on `items` keeps: hiding an item is a `$remove`,
    /// and the watch list raises the count as part of that mutation.
    func catalogBuilder() -> MilanoViewBuilder {
        engine.viewBuilder(document: Self.resource("catalog"))
            .context(Self.sharedContext)
            .stateData { _ in ["items": .array(Self.catalogItems), "hidden": .int(0)] }
            .actionHandler(Self.handle(_:))
            .label("catalog")
    }

    /// What the catalog service answers: one record per item, in the shape
    /// the document declares for `items`.
    private static let catalogItems: [MilanoValue] = [
        catalogItem("Bulbasaur", "Grass and poison. Loves the sun.", sprite: 1, slug: "bulbasaur"),
        catalogItem("Charmander", "Fire type. Keep it dry.", sprite: 4, slug: "charmander"),
        catalogItem("Squirtle", "Water type. Shell first.", sprite: 7, slug: "squirtle"),
        catalogItem("Pikachu", "Electric type. The famous one.", sprite: 25, slug: "pikachu")
    ]

    private static func catalogItem(_ name: String, _ blurb: String, sprite: Int, slug: String) -> MilanoValue {
        let sprites = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork"
        return .record([
            // The `id` is what the document keys its `$repeat` on, so an
            // item keeps its identity when the list is reordered.
            "id": .string(slug),
            "name": .string(name),
            "blurb": .string(blurb),
            "imageUrl": .string("\(sprites)/\(sprite).png"),
            "url": .string("https://www.pokemon.com/us/pokedex/\(slug)")
        ])
    }

    /// The interstitial: the document's `dismiss` action is interpreted by
    /// the presenting screen; every other action takes the shared path.
    func interstitialBuilder(onDismiss: @escaping @Sendable () -> Void) -> MilanoViewBuilder {
        engine.viewBuilder(document: Self.resource("interstitial"))
            .context(Self.sharedContext)
            .actionHandler { action in
                if case .dismiss = SampleAction(action) {
                    await MainActor.run { onDismiss() }
                    return nil
                }
                return try await Self.handle(action)
            }
            .label("interstitial")
    }

    /// The card detail: the numbers are context, and the document does
    /// the masking with the contract's string functions rather than
    /// receiving a pre-masked string. Nothing sensitive is computed here,
    /// and the reveal is state the document sets while the control is held.
    func cardDetailBuilder() -> MilanoViewBuilder {
        engine.viewBuilder(document: Self.resource("card-detail"))
            .context([
                "cardNumber": .string("4111111111111111"),
                "cardHolder": .string("Ada Lovelace"),
                "expiry": .string("0929"),
                "cvv": .string("123"),
                "capabilities": .string("Contactless, Online, ATM"),
                "cardStatus": .string("frozen"),
                "statusLabels": .record([
                    "active": .string("Active"),
                    "frozen": .string("Frozen"),
                    "expired": .string("Expired")
                ])
            ])
            .stateData { declarations in MilanoQuickStart.synthesizedState(for: declarations) }
            .actionHandler(Self.handle(_:))
            .label("card-detail")
    }

    /// The quick actions strip: one `$repeat` of tiles whose tap records
    /// the tapped position and then asks the host to open a screen.
    /// `navigate` is interpreted by the presenting screen, as `dismiss`
    /// is; everything else takes the shared path, so the analytics
    /// `track` is handled once for the whole sample.
    func quickActionsBuilder(
        onNavigate: @escaping @Sendable (SampleNavigateScreen) -> Void
    ) -> MilanoViewBuilder {
        engine.viewBuilder(document: Self.resource("quick-actions"))
            .context(Self.sharedContext)
            .stateData { _ in ["actions": .array(Self.quickActions), "lastTapped": .int(-1)] }
            .actionHandler { action in
                if case .navigate(let screen) = SampleAction(action) {
                    await MainActor.run { onNavigate(screen) }
                    return nil
                }
                return try await Self.handle(action)
            }
            .label("quick-actions")
    }

    /// What the quick actions service answers: the strip is data, so the
    /// app decides which shortcuts it offers today without shipping a new
    /// document.
    private static let quickActions: [MilanoValue] = [
        quickAction("profile", "Profile", icon: "person", screen: "profile"),
        quickAction("catalog", "Catalog", icon: "list", screen: "catalog"),
        quickAction("pokemon", "Pokemon", icon: "search", screen: "pokemon"),
        quickAction("contact", "Contact", icon: "edit", screen: "form")
    ]

    private static func quickAction(
        _ id: String, _ label: String, icon: String, screen: String
    ) -> MilanoValue {
        .record([
            "id": .string(id),
            "label": .string(label),
            // `icon` and `screen` are declared as enums in the document's
            // state, so a value outside the declared members is refused at
            // the build boundary instead of reaching a renderer as an icon
            // nobody draws.
            "icon": .string(icon),
            "screen": .string(screen)
        ])
    }

    /// The form: initial values arrive through the async state data
    /// provider, as if fetched from an API.
    func formBuilder() -> MilanoViewBuilder {
        engine.viewBuilder(document: Self.resource("contact-form"))
            .context(Self.sharedContext)
            .stateData { declarations in
                try await Task.sleep(nanoseconds: 700_000_000)
                return MilanoQuickStart.synthesizedState(for: declarations)
            }
            .actionHandler(Self.handle(_:))
            .label("contact-form")
    }

    // MARK: - Action funnel

    /// The single async funnel: navigation and submission live in the host.
    /// Generated bindings make the switch typed and exhaustive. The returned
    /// value is the completion result: submitContact declares `result:
    /// "string"`, so its confirmation number flows back into the document's
    /// onSuccess actions as the `result` root; a thrown `MilanoActionFailure`
    /// carries the declared failure payload back as the `failure` root.
    /// Every action arrives with its dispatch identity, the idempotency key
    /// a real handler would send along with its request.
    @Sendable private static func handle(_ action: MilanoAction) async throws -> MilanoValue? {
        switch SampleAction(action) {
        case .openUrl(let urlString):
            // The handler is the last capability check (state and actions
            // spec): the gate proved `url` is a string, not that it is safe
            // to open. Only https with a host leaves the app; a real app
            // narrows this to its own hosts. Throwing fails the completion.
            guard let components = URLComponents(string: urlString),
                components.scheme?.lowercased() == "https",
                let host = components.host, !host.isEmpty,
                let url = components.url
            else {
                print("[sample] refused url \(urlString): only https with a host is opened")
                throw SampleError.refusedUrl(urlString)
            }
            #if canImport(UIKit)
                await MainActor.run { UIApplication.shared.open(url) }
            #elseif canImport(AppKit)
                await MainActor.run { NSWorkspace.shared.open(url) }
            #endif
            return nil
        case .submitContact(let email, let name, let phone, let surname):
            // Simulated network call; the returned confirmation number is
            // what a real backend would answer with. The failure payload is
            // the declared enum: the document decides what to tell the user.
            // A plain error would be an invalid completion against the
            // non-optional declaration, so every failure is mapped here.
            print("[sample] submitting \(name) \(surname) <\(email)> \(phone) dispatch \(action.dispatchId)")
            try await Task.sleep(nanoseconds: 1_000_000_000)
            guard email.hasSuffix(".invalid") == false else {
                throw MilanoActionFailure(.string(SampleSubmitContactFailure.invalidEmail.rawValue))
            }
            guard !email.hasPrefix("offline") else {
                throw MilanoActionFailure(.string(SampleSubmitContactFailure.unavailable.rawValue))
            }
            return .string("MC-\(UUID().uuidString.prefix(6))")
        case .track(let event, let position, let surface):
            // Two sources, one sink: the interstitial's lifecycle bindings
            // report an impression, the quick actions strip reports a tap
            // with its position. `position` is optional, so an impression
            // has none and a tap on the third tile reports 2. The document
            // supplies it from the repeat's index binding; nothing here
            // counts.
            let suffix = position.map { " position \($0)" } ?? ""
            print("[sample] \(surface) \(event.rawValue)\(suffix)")
            return nil
        case .dismiss:
            // Interpreted by the presenting screen's handler; inert here.
            return nil
        case .navigate:
            // Interpreted by the presenting screen's handler; inert here.
            return nil
        case .unrecognized(let action):
            print("[sample] unhandled action \(action.name)")
            return nil
        }
    }

    private static func resource(_ name: String) -> Data {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json"),
            let data = try? Data(contentsOf: url)
        else {
            fatalError("missing bundled resource \(name).json")
        }
        return data
    }
}
