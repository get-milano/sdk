import MilanoSDK
import SwiftUI

/// A whole user-profile screen as one document: identity from context,
/// settings as state, everything below the navigation bar declared in
/// profile.json. The document pins `vocabulary.min: 1.1.0`, so an app
/// holding an older vocabulary fails the build instead of rendering a
/// half-understood profile.
struct ProfileScreen: View {
    var body: some View {
        ScrollView {
            MilanoHost(
                builder: SampleEnvironment.shared.documentBuilder(
                    resource: "profile",
                    screenContext: [
                        "memberSince": .string("March 2024"),
                        "avatarUrl": .string(
                            "https://raw.githubusercontent.com/PokeAPI/sprites/master"
                                + "/sprites/pokemon/other/official-artwork/25.png")
                    ])
            ) {
                ProgressView()
            } failure: { error in
                Text(String(describing: error))
                    .font(.caption)
                    .padding()
            }
        }
        .navigationTitle("Profile")
    }
}
