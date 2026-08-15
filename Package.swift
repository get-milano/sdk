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
            url: "https://github.com/get-milano/sdk/releases/download/v0.0.2/MilanoSDK.xcframework.zip",
            checksum: "8830879b60045c87717d28609dc3f445a2483f4e34972759c49adfe1d7c20987"
        )
    ]
)
