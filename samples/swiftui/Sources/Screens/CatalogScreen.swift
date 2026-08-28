import MilanoSDK
import SwiftUI

/// An intermediate screen, catalog-style, as one document: a `$repeat`
/// over the items the state data provider supplies, each instance a card
/// bound to `tap` -> `openUrl` with the item's own page, opened through
/// the host's action handler.
struct CatalogScreen: View {
    var body: some View {
        ScrollView {
            MilanoHost(
                builder: SampleEnvironment.shared.catalogBuilder()
            ) {
                ProgressView()
            } failure: { error in
                Text(String(describing: error))
                    .font(.caption)
                    .padding()
            }
        }
        .navigationTitle("Catalog")
    }
}
