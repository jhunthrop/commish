// swift-tools-version: 6.0
// The Our record screen (the web's record page at /record, drawn from the run): what each record
// grades and against what, the summary, the weeks with their status words and, graded, their figures
// beside each yardstick, the season to date, the draft record, the basis once. Its snapshots, both
// themes at two phone sizes, are the screen's mock.
import PackageDescription

let package = Package(
    name: "Record",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "Record", targets: ["Record"])],
    dependencies: [
        .package(path: "../BoxScore"),
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
    ],
    targets: [
        .target(
            name: "Record",
            dependencies: [
                .product(name: "BoxScore", package: "BoxScore"),
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
            ]
        ),
        .testTarget(
            name: "RecordTests",
            dependencies: [
                "Record",
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "RunFixtures", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ]
)
