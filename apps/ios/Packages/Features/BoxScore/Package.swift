// swift-tools-version: 6.0
// The box score's parts every in-season screen draws (the web's BoxTable, BoxLine, BoxPlayer and
// TeamFigures at 390): a player's row, the column heads, the Team row lit like the score bug, the
// table's frame and its section heads. The Start screen and the Matchup draw their tables from these.
import PackageDescription

let package = Package(
    name: "BoxScore",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "BoxScore", targets: ["BoxScore"])],
    dependencies: [
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
    ],
    targets: [
        .target(
            name: "BoxScore",
            dependencies: [
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
            ]
        ),
    ]
)
