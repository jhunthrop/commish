// swift-tools-version: 6.0
// The player sheet's body and the player page (the web's player shelf and /players/[slug] at 390): his
// week's game and its figures as cells, our read as the web's shelf prints it, the basis once; his page
// with the one big number and its basis, where drafters take him, his range, our read in the reading
// face and the league's one verb. Their snapshots, both themes at two phone sizes, are the mock.
import PackageDescription

let package = Package(
    name: "Player",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "Player", targets: ["Player"])],
    dependencies: [
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
        .package(path: "../Shell"),
    ],
    targets: [
        .target(
            name: "Player",
            dependencies: [
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
            ]
        ),
        .testTarget(
            name: "PlayerTests",
            dependencies: [
                "Player",
                .product(name: "Shell", package: "Shell"),
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "RunFixtures", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ]
)
