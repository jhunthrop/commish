// swift-tools-version: 6.0
// The Rankings screen (the web's Players page in season at /players): the page named Rankings with the
// week in the sentence under it, the search, the position chips, our rest-of-season order as a box
// score with each player's week and every place the API's own, the kickers' and defenses' week in the
// published projection's order on the K and D/ST chips, the basis once. Its snapshots, both themes at
// two phone sizes, are the screen's mock.
import PackageDescription

let package = Package(
    name: "Rankings",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "Rankings", targets: ["Rankings"])],
    dependencies: [
        .package(path: "../BoxScore"),
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
    ],
    targets: [
        .target(
            name: "Rankings",
            dependencies: [
                .product(name: "BoxScore", package: "BoxScore"),
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
            ]
        ),
        .testTarget(
            name: "RankingsTests",
            dependencies: [
                "Rankings",
                .product(name: "BoxScore", package: "BoxScore"),
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "RunFixtures", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ]
)
