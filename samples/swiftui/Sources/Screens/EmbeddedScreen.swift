import MilanoSDK
import SwiftUI

/// Milano as an embedded fragment: a native card, a Milano banner, and a
/// native carousel sharing one screen. The Milano subtree is just another
/// view in the hierarchy.
struct EmbeddedScreen: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                NativeCard(
                    icon: "creditcard",
                    title: "Your balance",
                    detail: "$1,240.50 · updated just now")

                MilanoHost(builder: SampleEnvironment.shared.documentBuilder(resource: "banner-strip")) {
                    ProgressView().frame(maxWidth: .infinity).padding()
                } failure: { _ in
                    EmptyView()
                }

                NativeCarousel()
            }
        }
        .navigationTitle("Embedded")
    }
}

private struct NativeCard: View {
    let icon: String
    let title: String
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(.indigo)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundColor(.secondary)
            }
            Spacer()
        }
        .padding(16)
        .background(Color.secondaryBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }
}

private struct NativeCarousel: View {
    private let items = [
        ("airplane", "Flights"),
        ("bed.double", "Hotels"),
        ("car", "Rentals"),
        ("map", "Guides")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Plan something")
                .font(.headline)
                .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(items, id: \.1) { item in
                        VStack(spacing: 8) {
                            Image(systemName: item.0).font(.title2)
                            Text(item.1).font(.caption)
                        }
                        .frame(width: 96, height: 84)
                        .background(Color.secondaryBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        .padding(.vertical, 8)
    }
}
