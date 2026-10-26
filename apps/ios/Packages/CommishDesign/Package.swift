// swift-tools-version: 6.3
// The design: tokens and words generated from shared/, the three faces, the theme, the mark and the
// box score primitives every screen draws with. CommishSnapshotSupport renders a view to PNG and
// compares it with the committed one: each screen's mock is its snapshot.
import PackageDescription

let package = Package(
    name: "CommishDesign",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [
        .library(name: "CommishDesign", targets: ["CommishDesign"]),
        .library(name: "CommishSnapshotSupport", targets: ["CommishSnapshotSupport"]),
    ],
    targets: [
        .target(
            name: "CommishDesign",
            exclude: ["Fonts/OFL.txt"],
            resources: [
                .copy("Fonts/Outfit.woff2"),
                .copy("Fonts/BigShouldersDisplay.woff2"),
                .copy("Fonts/Newsreader.woff2"),
            ]
        ),
        .target(name: "CommishSnapshotSupport", dependencies: ["CommishDesign"]),
        .testTarget(name: "CommishDesignTests", dependencies: ["CommishDesign", "CommishSnapshotSupport"]),
    ],
    swiftLanguageModes: [.v6]
)
