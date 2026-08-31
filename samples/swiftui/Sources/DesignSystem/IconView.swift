import SwiftUI

/// Semantic icon: a document names a meaning, never an asset name, and
/// this design system decides what the meaning looks like. SF Symbols
/// here, Material icons in the Compose samples, emoji in the React Native
/// one, all from the same document.
///
/// `container` is the second thing a document may say: whether the icon
/// stands alone or is shown inside something. What "inside something"
/// looks like, a tinted circle of this size, is decided here.
struct IconModel {
    enum Name {
        case person
        case list
        case search
        case edit
        case settings
        case help
    }

    enum Container {
        case none
        case circle
    }

    var name: Name
    var container: Container = .none
}

struct IconView: View {
    let model: IconModel

    private static let circle: CGFloat = 56

    private var symbol: String {
        switch model.name {
        case .person: return "person.crop.circle"
        case .list: return "list.bullet"
        case .search: return "magnifyingglass"
        case .edit: return "square.and.pencil"
        case .settings: return "gearshape"
        case .help: return "questionmark.circle"
        }
    }

    var body: some View {
        glyph
            // Decorative: whatever contains the icon carries the label and
            // the accessibility label, so describing the glyph as well
            // would read the same thing twice.
            .accessibilityHidden(true)
    }

    @ViewBuilder private var glyph: some View {
        switch model.container {
        case .none:
            Image(systemName: symbol)
                .font(.system(size: 26))
                .foregroundColor(.accentColor)
        case .circle:
            Image(systemName: symbol)
                .font(.system(size: 24))
                .foregroundColor(.accentColor)
                .frame(width: Self.circle, height: Self.circle)
                .background(Color.accentColor.opacity(0.15))
                .clipShape(Circle())
        }
    }
}
