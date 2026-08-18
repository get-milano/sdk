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
            url: "https://github.com/get-milano/sdk/releases/download/v1.1.1/MilanoSDK.xcframework.zip",
            checksum: "1d4e62d69c7c2acef7007d30f768df81851f38c41d27797179475a6929518cc5"
        )
    ]
)
