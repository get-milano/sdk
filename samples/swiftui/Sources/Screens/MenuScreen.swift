import MilanoSDK
import SwiftUI

/// Menu + push navigation: each demo screen builds its MilanoView on entry,
/// so the loading view is visible every time.
struct MenuScreen: View {
    /// Dev affordance: MILANO_SCREEN=banner|banner-card|banner-strip|form|
    /// embedded|interstitial opens a demo directly (screenshot automation).
    private let autoScreen = ProcessInfo.processInfo.environment["MILANO_SCREEN"]
    @State private var showInterstitial = false

    var body: some View {
        #if os(macOS)
            // macOS has neither stack navigation nor full-screen covers;
            // the interstitial is presented as a sheet instead.
            NavigationView {
                content
            }
            .sheet(isPresented: $showInterstitial) {
                InterstitialScreen(onDismiss: { showInterstitial = false })
            }
        #else
            NavigationView {
                content
            }
            .navigationViewStyle(.stack)
            .fullScreenCover(isPresented: $showInterstitial) {
                InterstitialScreen(onDismiss: { showInterstitial = false })
            }
        #endif
    }

    @ViewBuilder
    private var content: some View {
        switch autoScreen {
        case "embedded":
            EmbeddedScreen()
        case "interstitial":
            InterstitialScreen(onDismiss: {})
        case "pokemon":
            PokemonScreen()
        default:
            if let demo = Demo(screenKey: autoScreen) {
                DemoScreen(demo: demo)
            } else {
                menu
            }
        }
    }

    private var menu: some View {
        List {
            Section("Banners") {
                ForEach(Demo.banners) { demo in
                    NavigationLink(demo.title) { DemoScreen(demo: demo) }
                }
            }
            Section("Forms") {
                NavigationLink(Demo.form.title) { DemoScreen(demo: .form) }
            }
            Section("Expressions") {
                NavigationLink(Demo.tipCalculator.title) { DemoScreen(demo: .tipCalculator) }
                NavigationLink(Demo.checkboxGate.title) { DemoScreen(demo: .checkboxGate) }
            }
            Section("Context") {
                NavigationLink("Pokemon · Screen context") { PokemonScreen() }
            }
            Section("Integration") {
                NavigationLink("Embedded in native UI") { EmbeddedScreen() }
                Button("Interstitial") { showInterstitial = true }
            }
            Section("Engine") {
                Text("Milano SDK \(MilanoInfo.version)")
                    .foregroundColor(.secondary)
            }
        }
        .navigationTitle("Milano")
    }
}
