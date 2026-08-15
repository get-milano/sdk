import SwiftUI

/// Cross-platform stand-ins for UIKit's semantic backgrounds, so screens
/// build natively on macOS as well as iOS.
extension Color {
    static var primaryBackground: Color {
        #if os(macOS)
            Color(nsColor: .windowBackgroundColor)
        #else
            Color(.systemBackground)
        #endif
    }

    static var secondaryBackground: Color {
        #if os(macOS)
            Color(nsColor: .underPageBackgroundColor)
        #else
            Color(.secondarySystemBackground)
        #endif
    }
}
