import MilanoSDK
import SwiftUI

/// A card whose number, expiry, and CVV are masked until the reveal
/// control is held. The masking is the document's own work, done with the
/// contract's string functions over the values in context, so the host
/// hands over the card once and never a pre-masked copy of it.
struct CardDetailScreen: View {
    var body: some View {
        ScrollView {
            MilanoHost(builder: SampleEnvironment.shared.cardDetailBuilder()) {
                ProgressView()
            } failure: { error in
                Text(String(describing: error))
                    .font(.caption)
                    .padding()
            }
        }
        .navigationTitle("Card detail")
    }
}
