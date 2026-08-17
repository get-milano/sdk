import SwiftUI

/// The hosting container, for hosts that want the swap managed for them:
/// presents the loading content immediately, awaits the build, replaces it
/// with the MilanoView on success or the error content on failure.
/// Building starts once per container lifetime; recreate the container to
/// retry.
public struct MilanoHost<Loading: View, Failure: View>: View {
    private enum Phase {
        case loading
        case ready(MilanoView)
        case failed(any Error)
    }

    private let builderResult: Result<MilanoViewBuilder, any Error>
    private let loading: () -> Loading
    private let failure: (any Error) -> Failure
    @State private var phase: Phase = .loading
    @State private var started = false

    public init(
        builder: MilanoViewBuilder,
        @ViewBuilder loading: @escaping () -> Loading,
        @ViewBuilder failure: @escaping (any Error) -> Failure
    ) {
        builderResult = .success(builder)
        self.loading = loading
        self.failure = failure
    }

    /// The quick path: one view from raw document and vocabulary bytes.
    /// Engine, registry, and builder are created inside; declared state is
    /// synthesized as zero-values (overridable via `state`); engine and
    /// build failures both land in the failure content. Ideal for a first
    /// integration or a simple embed; real apps share one engine and use
    /// the builder path.
    public init(
        document: Data,
        vocabulary: Data,
        renderers: [String: any MilanoRenderer],
        context: [String: MilanoValue] = [:],
        state: [String: MilanoValue] = [:],
        onAction: (@Sendable (MilanoAction) async throws -> MilanoValue?)? = nil,
        @ViewBuilder loading: @escaping () -> Loading,
        @ViewBuilder failure: @escaping (any Error) -> Failure
    ) {
        builderResult = Result {
            try MilanoQuickStart.builder(
                document: document, vocabulary: vocabulary, renderers: renderers,
                context: context, state: state, onAction: onAction)
        }
        self.loading = loading
        self.failure = failure
    }

    public var body: some View {
        content.task {
            guard !started else { return }
            started = true
            switch builderResult {
            case .failure(let error):
                phase = .failed(error)
            case .success(let builder):
                do {
                    phase = .ready(try await builder.build())
                } catch {
                    phase = .failed(error)
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            loading()
        case .ready(let view):
            view
        case .failed(let error):
            failure(error)
        }
    }
}
