// swift-tools-version: 6.0
// The Start screen (the web's Lineup at /league/[id]/start): the lineup as a box score with each
// slot's starter and the bench, the basis once, and the one verb pinned above the bar that sets the
// lineup on the platform or copies it. Its snapshots, both themes at two phone sizes and the fixture's
// clocks, are the screen's mock.
import PackageDescription

let package = Package(
    name: "Start",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "Start", targets: ["Start"])],
    dependencies: [
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
    ],
    targets: [
        .target(
            name: "Start",
            dependencies: [
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
            ]
        ),
        .testTarget(
            name: "StartTests",
            dependencies: [
                "Start",
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ]
)
