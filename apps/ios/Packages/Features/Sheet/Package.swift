// swift-tools-version: 6.3
// The cheat sheet (the web's /sheet at 390, with /sheet/print as the share sheet): the member's rows in
// the order the account holds them, a note and tags per player edited in place, each edit's save said on
// its row, the import of a CSV and the export handed to the share sheet, the empty sheet started from
// our board. Its snapshots, both themes at two phone sizes, are the screen's mock.
import PackageDescription

let package = Package(
    name: "Sheet",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "Sheet", targets: ["Sheet"])],
    dependencies: [
        .package(path: "../../CommishCore"),
        .package(path: "../../CommishDesign"),
        .package(path: "../../CommishAPI"),
        .package(path: "../Board"),
    ],
    targets: [
        .target(
            name: "Sheet",
            dependencies: [
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
                .product(name: "Board", package: "Board"),
            ]
        ),
        .testTarget(
            name: "SheetTests",
            dependencies: [
                "Sheet",
                .product(name: "Board", package: "Board"),
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "RunFixtures", package: "CommishAPI"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
            ],
            exclude: ["__Snapshots__"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
