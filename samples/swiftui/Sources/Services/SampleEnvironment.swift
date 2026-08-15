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
    private let engine: MilanoEngine

    private init() {
        do {
            engine = try MilanoEngine(
                vocabularyJSON: Self.resource("vocabulary"),
                registry: MilanoBridge.registry(),
                defaultUnknownTypePolicy: .skip,
                observer: observer)
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
        engine.viewBuilder(document: Self.resource(resource))
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
                if action.name == "dismiss" {
                    await MainActor.run { onDismiss() }
                } else {
                    try await Self.handle(action)
                }
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
    @Sendable private static func handle(_ action: MilanoAction) async throws {
        switch action.name {
        case "openUrl":
            if let urlString = action.parameters["url"]?.stringValue,
                let url = URL(string: urlString) {
                #if canImport(UIKit)
                    await MainActor.run { UIApplication.shared.open(url) }
                #elseif canImport(AppKit)
                    await MainActor.run { NSWorkspace.shared.open(url) }
                #endif
            }
        case "submitContact":
            // Simulated network call; returning normally completes with
            // success, which runs the document's onSuccess actions.
            print("[sample] submitting \(action.parameters)")
            try await Task.sleep(nanoseconds: 1_000_000_000)
        default:
            print("[sample] unhandled action \(action.name)")
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
