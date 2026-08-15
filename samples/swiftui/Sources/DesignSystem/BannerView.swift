import SwiftUI

/// A promotional surface. Pure UI: knows nothing about Milano.
struct BannerModel {
    enum Layout {
        case overlay
        case card
        case strip
    }

    var layout: Layout = .overlay
    var imageURL: URL?
    var height: CGFloat = 260
    var contentAlignment: Alignment = .bottomLeading
    var showScrim = true
    var cornerRadius: CGFloat = 16
}

struct BannerView<Content: View>: View {
    let model: BannerModel
    @ViewBuilder let content: () -> Content

    var body: some View {
        switch model.layout {
        case .overlay: overlay
        case .card: card
        case .strip: strip
        }
    }

    /// Content over the image, scrim for legibility.
    private var overlay: some View {
        VStack(alignment: .leading, spacing: 8) {
            content()
        }
        .padding(20)
        .environment(\.colorScheme, .dark)
        .frame(maxWidth: .infinity, minHeight: model.height, alignment: model.contentAlignment)
        .background(scrim)
        .background(image)
        .clipShape(RoundedRectangle(cornerRadius: model.cornerRadius))
        .padding(16)
    }

    /// Image on top, content below on a surface.
    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear
                .frame(height: model.height)
                .background(image)
                .clipped()
            VStack(alignment: .leading, spacing: 8) {
                content()
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: model.contentAlignment)
            .background(Color.secondaryBackground)
        }
        .clipShape(RoundedRectangle(cornerRadius: model.cornerRadius))
        .padding(16)
    }

    /// A slim, imageless announcement row.
    private var strip: some View {
        HStack(spacing: 12) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.indigo.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: model.cornerRadius))
        .padding(16)
    }

    private var image: some View {
        AsyncImage(url: model.imageURL) { phase in
            if case .success(let loaded) = phase {
                loaded.resizable().scaledToFill()
            } else {
                LinearGradient(
                    colors: [.indigo, .teal],
                    startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }
    }

    @ViewBuilder
    private var scrim: some View {
        if model.showScrim {
            LinearGradient(
                colors: [.clear, .black.opacity(0.65)],
                startPoint: .top, endPoint: .bottom)
        }
    }
}
