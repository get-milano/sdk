import ProjectDescription

// Framework project for building and distributing MilanoSDK as a signed
// xcframework. SwiftPM consumers keep using the root Package.swift; this
// project exists so xcodebuild archive slices are signed automatically
// with the Milano development team.
let project = Project(
    name: "MilanoSDK",
    settings: .settings(base: [
        "DEVELOPMENT_TEAM": "2U378HJ7FG",
        "CODE_SIGN_STYLE": "Automatic",
        // Required for xcframework distribution.
        "BUILD_LIBRARY_FOR_DISTRIBUTION": "YES",
        "SKIP_INSTALL": "NO"
    ]),
    targets: [
        .target(
            name: "MilanoSDK",
            destinations: [.iPhone, .iPad, .mac, .appleWatch],
            product: .framework,
            bundleId: "dev.getmilano.sdk",
            deploymentTargets: .multiplatform(
                iOS: "15.0",
                macOS: "12.0",
                watchOS: "8.0"
            ),
            infoPlist: .default,
            sources: ["Sources/MilanoSDK/**"]
        ),
        .target(
            name: "MilanoSDKTests",
            destinations: [.iPhone, .iPad, .mac],
            product: .unitTests,
            bundleId: "dev.getmilano.sdk.tests",
            deploymentTargets: .multiplatform(
                iOS: "16.0",
                macOS: "26.0"
            ),
            infoPlist: .default,
            sources: ["Tests/MilanoSDKTests/**"],
            dependencies: [
                .target(name: "MilanoSDK")
            ]
        )
    ]
)
