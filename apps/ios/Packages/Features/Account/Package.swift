// swift-tools-version: 6.3
// The Account screen (the web's /account): who, the leagues followed with detach and its undo, the
// plan in the free season, the push switches kept on this phone, the paired devices with this phone
// marked and unpair, sign out, and the signed-out return. Its snapshots, both themes at two phone
// sizes, are the screen's mock.
import PackageDescription

let package = Package(
    name: "Account",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "Account", targets: ["Account"])],
    dependencies: [
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
    ],
    targets: [
        .target(
            name: "Account",
            dependencies: [
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
            ]
        ),
        .testTarget(
            name: "AccountTests",
            dependencies: [
                "Account",
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
