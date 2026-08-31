import MilanoSDK
import SwiftUI

/// A horizontal strip of tiles from one `$repeat` template: each tap
/// records the tapped tile's position through the repeat's index binding
/// and then asks the host to push a screen. The document never names a
/// view type or an asset; it names a declared screen and a declared icon,
/// and this host decides what both mean.
struct QuickActionsScreen: View {
    @State private var destination: SampleNavigateScreen?

    var body: some View {
        ScrollView {
            MilanoHost(
                builder: SampleEnvironment.shared.quickActionsBuilder { screen in
                    destination = screen
                }
            ) {
                ProgressView()
            } failure: { error in
                Text(String(describing: error))
                    .font(.caption)
                    .padding()
            }
        }
        .background(pushed)
        .navigationTitle("Quick actions")
    }

    /// The push itself. The screen name is a declared enum member, so the
    /// gate has already proved it is one of four; this maps it onto the
    /// sample's own screens.
    @ViewBuilder private var pushed: some View {
        NavigationLink(
            destination: destinationView,
            isActive: Binding(
                get: { destination != nil },
                set: { active in
                    if !active { destination = nil }
                }
            )
        ) {
            EmptyView()
        }
        .hidden()
    }

    @ViewBuilder private var destinationView: some View {
        switch destination {
        case .profile: ProfileScreen()
        case .catalog: CatalogScreen()
        case .pokemon: PokemonScreen()
        case .form: DemoScreen(demo: .form)
        case nil: EmptyView()
        }
    }
}
