// swift-tools-version: 6.3
// The live-draft companion (the web's /companion/new and /companion/[id] at 390): the second screen for
// a draft running on another platform. The start page follows a draft from a seat; the followed draft
// shows the platform's pick count, the picks as they land, at the drafter's turn our call with each
// player's chance of lasting to the next one and the verb that opens the platform's draft room, the
// pool and the team; the report once the draft is over. Its snapshots, both themes at two phone
// sizes, are the mock.
import PackageDescription

let package = Package(
    name: "Companion",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "Companion", targets: ["Companion"])],
    dependencies: [
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
        .package(path: "../Board"),
    ],
    targets: [
        .target(
            name: "Companion",
            dependencies: [
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
                .product(name: "Board", package: "Board"),
            ]
        ),
        .testTarget(
            name: "CompanionTests",
            dependencies: [
                "Companion",
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "RunFixtures", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
