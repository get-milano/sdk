import ProjectDescription

let project = Project(
    name: "MilanoSampleApp",
    packages: [
        .package(path: "../..")
    ],
    settings: .settings(base: [
        "DEVELOPMENT_TEAM": "2U378HJ7FG",
        "CODE_SIGN_STYLE": "Automatic",
        // The bindings script phase writes into the source tree.
        "ENABLE_USER_SCRIPT_SANDBOXING": "NO"
    ]),
    targets: [
        .target(
            name: "MilanoSampleApp",
            destinations: [.iPhone, .iPad, .macWithiPadDesign, .mac],
            product: .app,
            bundleId: "dev.getmilano.sample",
            deploymentTargets: .multiplatform(
                iOS: "15.0",
                macOS: "12.0"
            ),
            infoPlist: .extendingDefault(with: [
                // The launch screen is the mark on the system background,
                // so it follows light and dark without a second asset.
                // The image lives in Assets.xcassets, generated with every
                // other app asset by samples/scripts/generate-app-assets.py.
                "UILaunchScreen": [
                    "UIImageName": "LaunchLogo",
                    "UIImageRespectsSafeAreaInsets": true
                ],
                // The three sample apps carry the SDK's version, so a
                // screenshot or a TestFlight build says which release it
                // demonstrates. Checked by scripts/check-consistency.mjs.
                "CFBundleShortVersionString": "1.2.0"
            ]),
            sources: ["Sources/**"],
            resources: ["Resources/**"],
            scripts: [
                // Producer tooling as build steps, mirroring the Compose
                // sample's Gradle tasks: typed bindings and the editor
                // schema are regenerated from the vocabulary, and every
                // bundled document is validated through the reference
                // gate, so none of them can drift. The tools live in the
                // specs repository (sibling checkout, or MILANO_SPECS_DIR).
                .pre(
                    script: """
                    SPECS_DIR="${MILANO_SPECS_DIR:-$SRCROOT/../../../specs}"
                    python3 "$SPECS_DIR/tools/generate_bindings.py" \
                        "$SRCROOT/Resources/vocabulary.json" \
                        --swift-prefix Sample \
                        --swift-out "$SRCROOT/Sources/MilanoBridge/GeneratedBindings.swift"
                    python3 "$SPECS_DIR/tools/generate_document_schema.py" \
                        "$SRCROOT/Resources/vocabulary.json" \
                        --out "$SRCROOT/documents.schema.json"
                    for doc in "$SRCROOT"/Resources/*.json; do
                        [ "$(basename "$doc")" = "vocabulary.json" ] && continue
                        python3 "$SPECS_DIR/tools/reference_check.py" \
                            --document "$doc" \
                            --vocabulary "$SRCROOT/Resources/vocabulary.json"
                    done
                    """,
                    name: "Generate Milano bindings and validate documents",
                    basedOnDependencyAnalysis: false
                )
            ],
            dependencies: [
                .package(product: "MilanoSDK")
            ],
            settings: .settings(base: [
                "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon"
            ])
        )
    ]
)
