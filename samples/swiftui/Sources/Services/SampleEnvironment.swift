import Foundation
import MilanoSDK

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

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
                userInteractionObserver: analytics)
            SampleVocabulary.assertMatches(engine)
        } catch {
            fatalError("Milano engine setup failed: \(error)")
        }
    }

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
            .stateData { declarations in Self.defaults(for: declarations) }
            .actionHandler(Self.handle(_:))
            .label(resource)
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

    /// The form: initial values arrive through the async state data
    /// provider, as if fetched from an API.
    func formBuilder() -> MilanoViewBuilder {
        engine.viewBuilder(document: Self.resource("contact-form"))
            .context(Self.sharedContext)
            .stateData { declarations in
                try await Task.sleep(nanoseconds: 700_000_000)
                return Self.defaults(for: declarations)
            }
            .actionHandler(Self.handle(_:))
            .label("contact-form")
    }

    // MARK: - Provider defaults

    private static func defaults(for declarations: [String: MilanoType]) -> [String: MilanoValue] {
        declarations.mapValues { type in
            if type.optional { return .null }
            switch type.kind {
            case .bool: return .bool(false)
            case .int: return .int(0)
            case .double: return .double(0)
            default: return .string("")
            }
        }
    }

    // MARK: - Action funnel

    /// The single async funnel: navigation and submission live in the host.
    /// Generated bindings make the switch typed and exhaustive. The returned
    /// value is the completion result: submitContact declares `result:
    /// "string"`, so its confirmation number flows back into the document's
    /// onSuccess actions as the `result` root.
    @Sendable private static func handle(_ action: MilanoAction) async throws -> MilanoValue? {
        switch SampleAction(action) {
        case .openUrl(let urlString):
            if let url = URL(string: urlString) {
                #if canImport(UIKit)
                    await MainActor.run { UIApplication.shared.open(url) }
                #elseif canImport(AppKit)
                    await MainActor.run { NSWorkspace.shared.open(url) }
                #endif
            }
            return nil
        case .submitContact(let name, let surname, let email, let phone):
            // Simulated network call; the returned confirmation number is
            // what a real backend would answer with.
            print("[sample] submitting \(name) \(surname) <\(email)> \(phone ?? "-")")
            try await Task.sleep(nanoseconds: 1_000_000_000)
            return .string("MC-\(UUID().uuidString.prefix(6))")
        case .dismiss:
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
