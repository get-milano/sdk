import Foundation
import MilanoSDK
import SwiftUI

/// One MilanoHost, two context sources: the app-wide shared context (the
/// trainer name) plus screen-specific values fetched from PokeAPI and
/// injected into this screen's builder. The document declares all four
/// keys; the gate validates them together at build.
struct PokemonScreen: View {
    @State private var screenContext: [String: MilanoValue]?
    @State private var fetchFailure: String?

    var body: some View {
        content
            .navigationTitle("Pokemon")
    }

    @ViewBuilder
    private var content: some View {
        if let screenContext {
            ScrollView {
                MilanoHost(
                    builder: SampleEnvironment.shared.documentBuilder(
                        resource: "pokemon", screenContext: screenContext)
                ) {
                    ProgressView()
                } failure: { error in
                    Text(String(describing: error))
                        .font(.caption)
                        .padding()
                }
            }
        } else if let fetchFailure {
            VStack(spacing: 8) {
                Text("Fetch failed").font(.headline)
                Text(fetchFailure)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
        } else {
            ProgressView("Fetching from PokeAPI…")
                .task { await fetch() }
        }
    }

    /// The screen owns its data: fetched before the document is built,
    /// then handed to Milano as plain context values.
    private func fetch() async {
        do {
            let url = URL(string: "https://pokeapi.co/api/v2/pokemon/pikachu")!
            let (data, _) = try await URLSession.shared.data(from: url)
            guard
                let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let name = object["name"] as? String,
                let height = object["height"] as? Int,
                let weight = object["weight"] as? Int,
                let sprites = object["sprites"] as? [String: Any],
                let other = sprites["other"] as? [String: Any],
                let artwork = other["official-artwork"] as? [String: Any],
                let imageUrl = artwork["front_default"] as? String
            else {
                fetchFailure = "unexpected PokeAPI payload"
                return
            }
            screenContext = [
                "pokemonName": .string(name),
                "pokemonHeight": .double(Double(height)),
                "pokemonWeight": .double(Double(weight)),
                "pokemonImageUrl": .string(imageUrl)
            ]
        } catch {
            fetchFailure = String(describing: error)
        }
    }
}
