// swift-tools-version: 6.0
// The shell every tab shares: the top bar with the league switch, the search and the account's way
// in, the switch's list, the player sheet frame every screen presents from a row, and the screens
// named until their lanes land. Its snapshots, both themes at two phone sizes, are the shell's mock.
import PackageDescription

let package = Package(
    name: "Shell",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "Shell", targets: ["Shell"])],
    dependencies: [
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
    ],
    targets: [
        .target(
            name: "Shell",
            dependencies: [
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
            ]
        ),
        .testTarget(
            name: "ShellTests",
            dependencies: [
                "Shell",
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ]
)
