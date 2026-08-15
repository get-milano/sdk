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

    private let builder: MilanoViewBuilder
    private let loading: () -> Loading
    private let failure: (any Error) -> Failure
    @State private var phase: Phase = .loading
    @State private var started = false

    public init(
        builder: MilanoViewBuilder,
        @ViewBuilder loading: @escaping () -> Loading,
        @ViewBuilder failure: @escaping (any Error) -> Failure
    ) {
        self.builder = builder
        self.loading = loading
        self.failure = failure
    }

    public var body: some View {
        content.task {
            guard !started else { return }
            started = true
            do {
                phase = .ready(try await builder.build())
            } catch {
                phase = .failed(error)
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
