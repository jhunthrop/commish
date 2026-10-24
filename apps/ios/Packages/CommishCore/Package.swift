// swift-tools-version: 6.0
// The app's core: plain models mapped from the generated types, view models, the clock, the session
// in the Keychain, the cache of the last answer per screen, and sign-in. No UIKit, no SwiftUI, so
// `swift test` runs every rule on a Mac.
import PackageDescription

let package = Package(
    name: "CommishCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "CommishCore", targets: ["CommishCore"])],
    dependencies: [
        .package(path: "../CommishAPI"),
        .package(path: "../CommishDesign"),
    ],
    targets: [
        .target(
            name: "CommishCore",
            dependencies: [
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishDesign", package: "CommishDesign"),
            ]
        ),
        .testTarget(name: "CommishCoreTests", dependencies: ["CommishCore"]),
    ]
)
