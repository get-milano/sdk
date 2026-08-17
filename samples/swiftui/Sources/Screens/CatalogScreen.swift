import MilanoSDK
import SwiftUI

/// An intermediate screen, catalog-style, as one document: a list of item
/// cards (documents are data, so a producer enumerates them), each bound
/// to `tap` -> `openUrl`, so tapping an item opens its page through the
/// host's action handler.
struct CatalogScreen: View {
    var body: some View {
        ScrollView {
            MilanoHost(
                builder: SampleEnvironment.shared.documentBuilder(resource: "catalog")
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
