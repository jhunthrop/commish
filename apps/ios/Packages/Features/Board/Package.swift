// swift-tools-version: 6.0
// The Board screen (the web's board at /board/[format]/[position]): the format and position chips,
// the rows as a box score in our order, each player's number the API's own, the season-long players
// under their head, the basis once, and the one verb pinned above the bar. Its snapshots, both themes
// at two phone sizes, are the screen's mock.
import PackageDescription

let package = Package(
    name: "Board",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "Board", targets: ["Board"])],
    dependencies: [
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
    ],
    targets: [
        .target(
            name: "Board",
            dependencies: [
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
            ]
        ),
        .testTarget(
            name: "BoardTests",
            dependencies: [
                "Board",
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ]
)
