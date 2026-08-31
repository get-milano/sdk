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
                "CFBundleShortVersionString": "2.1.0"
            ]),
            sources: ["Sources/**"],
            resources: ["Resources/**"],
            scripts: [
                // Producer tooling as build steps, mirroring the Compose
                // sample's Gradle tasks: typed bindings and the editor
                // schema are regenerated from the vocabulary, and every
                // bundled document is validated with the gate the engines
                // run, so none of them can drift. The Milano CLI does all
                // three; inside this repository it is the workspace package
                // (`npm ci && npm run build` at the repository root), a
                // consumer project runs `npx milano` from @get-milano/cli.
                .pre(
                    script: """
                    MILANO_CLI="${MILANO_CLI:-$SRCROOT/../../cli/dist/bin.js}"
                    # Xcode gives a build phase the PATH of whatever launched
                    # it, not a login shell's, so a Node installed by nvm,
                    # fnm, volta, asdf or mise is invisible here even though
                    # `node` works in every terminal. find-node.sh looks where
                    # those put it and explains itself when it cannot.
                    NODE="$(sh "$SRCROOT/Scripts/find-node.sh")" || exit 1
                    [ -f "$MILANO_CLI" ] || { echo "error: Milano CLI not built at $MILANO_CLI: run npm ci && npm run build at the repository root" >&2; exit 1; }
                    "$NODE" "$MILANO_CLI" bindings "$SRCROOT/Resources/vocabulary.json" \
                        --swift-prefix Sample \
                        --swift-out "$SRCROOT/Sources/MilanoBridge/GeneratedBindings.swift"
                    "$NODE" "$MILANO_CLI" schema "$SRCROOT/Resources/vocabulary.json" \
                        --out "$SRCROOT/documents.schema.json"
                    set --
                    for doc in "$SRCROOT"/Resources/*.json; do
                        [ "$(basename "$doc")" = "vocabulary.json" ] || set -- "$@" "$doc"
                    done
                    "$NODE" "$MILANO_CLI" validate "$@" --vocabulary "$SRCROOT/Resources/vocabulary.json"
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
