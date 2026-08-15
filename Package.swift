// swift-tools-version:6.0
import PackageDescription

// The repository root is the Swift package, so SwiftPM consumers can depend
// on the repo URL directly. Sources live under engine/swiftui.
let package = Package(
    name: "milano-sdk",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
        .watchOS(.v8)
    ],
    products: [
        .library(name: "MilanoSDK", targets: ["MilanoSDK"])
    ],
    targets: [
        .target(
            name: "MilanoSDK",
            path: "engine/swiftui/Sources/MilanoSDK"
        ),
        .testTarget(
            name: "MilanoSDKTests",
            dependencies: ["MilanoSDK"],
            path: "engine/swiftui/Tests/MilanoSDKTests"
        )
    ]
)
