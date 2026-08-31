import SwiftUI

/// A control whose point is the press, not the tap: the card detail shows
/// its numbers while a finger is down and hides them on release, so both
/// edges are reported and there is no click in between.
struct PressableIconModel {
    enum Icon {
        case eye
        case eyeOff
    }

    var icon: Icon
    var accessibilityLabel: String
    var accessibilityHint: String?
    var onPressStart: () -> Void
    var onPressEnd: () -> Void
}

struct PressableIcon: View {
    let model: PressableIconModel

    @State private var held = false

    private var symbol: String {
        switch model.icon {
        case .eye: return "eye"
        case .eyeOff: return "eye.slash"
        }
    }

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 18))
            .foregroundColor(.accentColor)
            .frame(width: 44, height: 44)
            .background(Color.accentColor.opacity(0.15))
            .clipShape(Circle())
            .contentShape(Circle())
            // A zero-distance drag is how SwiftUI reports the two edges of
            // a press: onChanged fires on touch down, onEnded on lift.
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !held else { return }
                        held = true
                        model.onPressStart()
                    }
                    .onEnded { _ in
                        held = false
                        model.onPressEnd()
                    }
            )
            .accessibilityElement()
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel(model.accessibilityLabel)
            .accessibilityHint(model.accessibilityHint ?? "")
            // VoiceOver has no press-and-hold: activating reveals and
            // immediately hides, the honest mapping of a momentary reveal.
            .accessibilityAction {
                model.onPressStart()
                model.onPressEnd()
            }
    }
}
