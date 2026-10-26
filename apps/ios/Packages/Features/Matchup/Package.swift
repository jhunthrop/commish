// swift-tools-version: 6.3
// The Matchup screen (the web's Sunday matchup at /league/[id]/matchup): the score bug with both
// teams, each team's box with its starters' live points and projections, the basis once; read again
// on the web's cadence while it is on screen. Its snapshots, both themes at two phone sizes at the
// fixture's Sunday clocks and after Sunday, are the screen's mock.
import PackageDescription

let package = Package(
    name: "Matchup",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "Matchup", targets: ["Matchup"])],
    dependencies: [
        .package(path: "../BoxScore"),
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
    ],
    targets: [
        .target(
            name: "Matchup",
            dependencies: [
                .product(name: "BoxScore", package: "BoxScore"),
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
            ]
        ),
        .testTarget(
            name: "MatchupTests",
            dependencies: [
                "Matchup",
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
