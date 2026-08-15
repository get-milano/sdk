import MilanoSDK
import SwiftUI

/// A full-screen Milano takeover. The document declares a `dismiss` action;
/// the host decides what dismissal means (closing this cover).
struct InterstitialScreen: View {
    let onDismiss: () -> Void

    var body: some View {
        ScrollView {
            MilanoHost(builder: SampleEnvironment.shared.interstitialBuilder(onDismiss: onDismiss)) {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 160)
            } failure: { error in
                Text(String(describing: error)).padding()
            }
        }
        .background(Color.primaryBackground)
    }
}
