// swift-tools-version:6.0
import PackageDescription

// Release manifest: this tag resolves to the prebuilt, signed
// XCFramework attached to the GitHub release. The source package
// lives on main.
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
        .binaryTarget(
            name: "MilanoSDK",
            url: "https://github.com/get-milano/sdk/releases/download/v1.2.1/MilanoSDK.xcframework.zip",
            checksum: "25c31f88165b2c94130e53b7932be032a0c50c42391b5415ccfbb016bcd57193"
        )
    ]
)
