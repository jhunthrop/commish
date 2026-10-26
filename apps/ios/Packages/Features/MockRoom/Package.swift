// swift-tools-version: 6.3
// The mock room (the web's /mock/new, /mock/[id], /mock/[id]/report and /mock/share/[code] at 390): the
// setup against bots, the solo room full screen with the web's bar at the bottom (the pick on the clock,
// Undo, Pick for me, Finish, Save and share), our call with its one verb, the strip since your pick,
// the pool with the queue, the wall and your team, the report as the web draws it, and a shared draft
// read by its code. The report's pick by pick and runs are the companion's (one report for both). Its
// snapshots, both themes at two phone sizes, are the mock.
import PackageDescription

let package = Package(
    name: "MockRoom",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "MockRoom", targets: ["MockRoom"])],
    dependencies: [
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
        .package(path: "../Board"),
        .package(path: "../Companion"),
    ],
    targets: [
        .target(
            name: "MockRoom",
            dependencies: [
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
                .product(name: "Board", package: "Board"),
                .product(name: "Companion", package: "Companion"),
            ]
        ),
        .testTarget(
            name: "MockRoomTests",
            dependencies: [
                "MockRoom",
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "RunFixtures", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
