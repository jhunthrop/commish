// swift-tools-version: 6.0
// The Trades screen (the web's trade finder at /league/[id]/trades): the strip of the trades worth
// proposing, each team's best or every trade by either side's gain, a trade opened into both sides'
// players as box-score rows with the check of both lineups before and after, the verb that copies the
// offer for the platform, the basis once. Its snapshots, both themes at two phone sizes, are the
// screen's mock.
import PackageDescription

let package = Package(
    name: "Trades",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "Trades", targets: ["Trades"])],
    dependencies: [
        .package(path: "../BoxScore"),
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
    ],
    targets: [
        .target(
            name: "Trades",
            dependencies: [
                .product(name: "BoxScore", package: "BoxScore"),
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
            ]
        ),
        .testTarget(
            name: "TradesTests",
            dependencies: [
                "Trades",
                .product(name: "BoxScore", package: "BoxScore"),
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ]
)
