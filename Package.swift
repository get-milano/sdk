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
            url: "https://github.com/get-milano/sdk/releases/download/v2.1.0/MilanoSDK.xcframework.zip",
            checksum: "dc76c0ce7dfe149d55812067e8ed3f33ccb460352eb0f1fb75b66d3f79f452c9"
        )
    ]
)
