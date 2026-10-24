// swift-tools-version: 6.0
// The League home: the week's scoreboard, the standings, the member's lineup and the moves, drawn from
// the Core's model; its snapshots, both themes at two phone sizes, are the screen's mock.
import PackageDescription

let package = Package(
    name: "LeagueHome",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "LeagueHome", targets: ["LeagueHome"])],
    dependencies: [
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
    ],
    targets: [
        .target(
            name: "LeagueHome",
            dependencies: [
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
            ]
        ),
        .testTarget(
            name: "LeagueHomeTests",
            dependencies: [
                "LeagueHome",
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ]
)
