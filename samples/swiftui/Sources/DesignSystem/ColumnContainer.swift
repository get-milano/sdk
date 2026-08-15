import SwiftUI

struct ColumnContainer<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            content()
        }
        .padding(16)
    }
}
