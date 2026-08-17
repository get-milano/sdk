import MilanoSDK
import SwiftUI

/// The quick path end to end: no engine, registry, builder, or providers
/// in sight. One view, an inline vocabulary and document, one renderer,
/// and an action closure. Every other screen goes through
/// SampleEnvironment, the full architecture for real apps.
struct QuickStartScreen: View {
    private static let vocabulary = Data(#"""
        {"milano": "1.0.0", "name": "quickstart", "version": "1.0.0",
         "components": {"Greeting": {"properties": {"text": "string"}, "events": {"tap": null}}},
         "actions": {"celebrate": {}}}
        """#.utf8)

    private static let document = Data(#"""
        {"version": "1.0.0",
         "context": {"userName": "string"},
         "state": {"taps": "int"},
         "root": {"type": "Greeting", "id": "hello",
                  "properties": {"text": {"$expr": "concat('Hello, ', context.userName, '! Taps: ', str(state.taps))"}},
                  "on": {"tap": [{"action": "$set", "key": "taps", "value": {"$expr": "state.taps + 1"}},
                                 {"action": "celebrate"}]}}}
        """#.utf8)

    var body: some View {
        MilanoHost(
            document: Self.document,
            vocabulary: Self.vocabulary,
            renderers: ["Greeting": GreetingRenderer()],
            context: ["userName": .string("Ada")],
            onAction: { action in
                print("[quickstart] dispatched \(action.name)")
                return nil
            },
            loading: { ProgressView() },
            failure: { error in
                Text(String(describing: error))
                    .font(.caption)
                    .padding()
            }
        )
        .navigationTitle("Quick start")
    }
}

private final class GreetingRenderer: MilanoRenderer {
    func render(_ node: MilanoNode) -> AnyView {
        AnyView(
            Text(node.property("text").stringValue ?? "")
                .font(.title2)
                .padding()
                .onTapGesture { node.emit("tap") }
        )
    }
}
