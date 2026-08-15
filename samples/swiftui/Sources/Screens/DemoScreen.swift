import MilanoSDK
import SwiftUI

/// One demo: a document, a title, and the builder that materializes it.
struct Demo: Identifiable {
    let id: String
    let title: String
    let makeBuilder: () -> MilanoViewBuilder

    static let overlayBanner = Demo(id: "banner", title: "Banner · Overlay") {
        SampleEnvironment.shared.documentBuilder(resource: "banner")
    }
    static let cardBanner = Demo(id: "banner-card", title: "Banner · Card") {
        SampleEnvironment.shared.documentBuilder(resource: "banner-card")
    }
    static let stripBanner = Demo(id: "banner-strip", title: "Banner · Strip") {
        SampleEnvironment.shared.documentBuilder(resource: "banner-strip")
    }
    static let form = Demo(id: "form", title: "Contact form") {
        SampleEnvironment.shared.formBuilder()
    }
    static let tipCalculator = Demo(id: "tip-calculator", title: "Tip calculator") {
        SampleEnvironment.shared.documentBuilder(resource: "tip-calculator")
    }
    static let checkboxGate = Demo(id: "checkbox-gate", title: "Checkbox gate") {
        SampleEnvironment.shared.documentBuilder(resource: "checkbox-gate")
    }

    static let banners: [Demo] = [.overlayBanner, .cardBanner, .stripBanner]

    init(id: String, title: String, makeBuilder: @escaping () -> MilanoViewBuilder) {
        self.id = id
        self.title = title
        self.makeBuilder = makeBuilder
    }

    init?(screenKey: String?) {
        switch screenKey {
        case "banner": self = .overlayBanner
        case "banner-card": self = .cardBanner
        case "banner-strip": self = .stripBanner
        case "form": self = .form
        case "tip-calculator": self = .tipCalculator
        case "checkbox-gate": self = .checkboxGate
        default: return nil
        }
    }
}

struct DemoScreen: View {
    let demo: Demo

    var body: some View {
        ScrollView {
            MilanoHost(builder: demo.makeBuilder()) {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Building…").foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 120)
            } failure: { error in
                VStack(spacing: 8) {
                    Text("Build failed").font(.headline)
                    Text(String(describing: error))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding()
            }
        }
        .navigationTitle(demo.title)
    }
}
