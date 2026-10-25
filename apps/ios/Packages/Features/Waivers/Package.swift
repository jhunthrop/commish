// swift-tools-version: 6.0
// The Waivers screen (the web's Waivers at /league/[id]/waivers): the strip with a card for each pickup
// worth making, the players free to add as a box score with the pickup rule's Beats cell, each row's
// drop panel, the basis once, and the one verb pinned above the bar that claims on the platform or
// opens its waiver page. Its snapshots, both themes at two phone sizes, are the screen's mock.
import PackageDescription

let package = Package(
    name: "Waivers",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "Waivers", targets: ["Waivers"])],
    dependencies: [
        .package(path: "../BoxScore"),
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
    ],
    targets: [
        .target(
            name: "Waivers",
            dependencies: [
                .product(name: "BoxScore", package: "BoxScore"),
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
            ]
        ),
        .testTarget(
            name: "WaiversTests",
            dependencies: [
                "Waivers",
                .product(name: "BoxScore", package: "BoxScore"),
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ]
)
