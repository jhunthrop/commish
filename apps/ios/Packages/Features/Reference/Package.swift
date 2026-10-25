// swift-tools-version: 6.0
// The reference screens (the web's /adp/[format], /compare, /clubs, /clubs/[abbr] and /schedule at
// 390), built from the Board's pattern and pushed on its stack: ADP in the drafters' order beside our
// board, two players side by side with our call, every club with its strength and lead player, a club's
// players and schedule, and the strength of schedule grid. Their snapshots, both themes at two phone
// sizes, are the mock.
import PackageDescription

let package = Package(
    name: "Reference",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "Reference", targets: ["Reference"])],
    dependencies: [
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
        .package(path: "../Board"),
        .package(path: "../BoxScore"),
    ],
    targets: [
        .target(
            name: "Reference",
            dependencies: [
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
                .product(name: "Board", package: "Board"),
                .product(name: "BoxScore", package: "BoxScore"),
            ]
        ),
        .testTarget(
            name: "ReferenceTests",
            dependencies: [
                "Reference",
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "RunFixtures", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ]
)
