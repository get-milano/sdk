import ProjectDescription

let project = Project(
    name: "MilanoSampleApp",
    packages: [
        .package(path: "../..")
    ],
    settings: .settings(base: [
        "DEVELOPMENT_TEAM": "2U378HJ7FG",
        "CODE_SIGN_STYLE": "Automatic"
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
                "UILaunchScreen": [:]
            ]),
            sources: ["Sources/**"],
            resources: ["Resources/**"],
            dependencies: [
                .package(product: "MilanoSDK")
            ],
            settings: .settings(base: [
                "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon"
            ])
        )
    ]
)
