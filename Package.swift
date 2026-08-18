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
            url: "https://github.com/get-milano/sdk/releases/download/v1.1.2/MilanoSDK.xcframework.zip",
            checksum: "5416888ef95d1f7170e1b22f205ad4ad184d521a1bbd1c86bc3e70c4a14e791b"
        )
    ]
)
