// swift-tools-version: 6.3
// The App Store screenshots (docs/store/app-store-graphics): the app's own screens over the shared
// fixtures, each under its caption, drawn at the two iPhone sizes App Store Connect takes. Test code
// only, and it draws nothing unless STORE_SHOTS names the folder to write:
// node apps/ios/scripts/store-shots.ts runs it, and ios.yml's store_shots dispatch runs that on CI.
import PackageDescription

let package = Package(
    name: "StoreShots",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    dependencies: [
        .package(path: "../CommishAPI"),
        .package(path: "../CommishCore"),
        .package(path: "../CommishDesign"),
        .package(path: "../Features/BoxScore"),
        .package(path: "../Features/Shell"),
        .package(path: "../Features/Start"),
        .package(path: "../Features/Waivers"),
        .package(path: "../Features/Trades"),
        .package(path: "../Features/Matchup"),
        .package(path: "../Features/Rankings"),
        .package(path: "../Features/Board"),
        .package(path: "../Features/MockRoom"),
        .package(path: "../Features/Player"),
    ],
    targets: [
        .testTarget(
            name: "StoreShotsTests",
            dependencies: [
                .product(name: "CommishAPI", package: "CommishAPI"),
                .product(name: "RunFixtures", package: "CommishAPI"),
                .product(name: "CommishCore", package: "CommishCore"),
                .product(name: "CommishDesign", package: "CommishDesign"),
                .product(name: "CommishSnapshotSupport", package: "CommishDesign"),
                .product(name: "BoxScore", package: "BoxScore"),
                .product(name: "Shell", package: "Shell"),
                .product(name: "Start", package: "Start"),
                .product(name: "Waivers", package: "Waivers"),
                .product(name: "Trades", package: "Trades"),
                .product(name: "Matchup", package: "Matchup"),
                .product(name: "Rankings", package: "Rankings"),
                .product(name: "Board", package: "Board"),
                .product(name: "MockRoom", package: "MockRoom"),
                .product(name: "Player", package: "Player"),
            ]
        ),
    ],
    swiftLanguageModes: [.v6]
)
