import CommishCore
import CommishSnapshotSupport
import Foundation

/// The eight screenshots, in the listing's order (docs/store/2026-10-26-play-listing.md §1.2, which the
/// App Store listing's §2 follows): each caption, the file it is written to, and the tab the app's bar
/// lights. The in-season tabs light their own tab; the rankings, the board and the player page are pages
/// pushed over the bar, so none is lit, as in the Play set; the mock room is full screen over the shell.
enum StoreShot: String, CaseIterable, Sendable {
    case lineup
    case waivers
    case trades
    case matchup
    case rankings
    case board
    case mockRoom
    case player

    var caption: String {
        switch self {
        case .lineup: "The lineup to start, every week"
        case .waivers: "Your best add on waivers"
        case .trades: "Trades that help both teams"
        case .matchup: "Your game, kept up to date"
        case .rankings: "Our rest-of-season order"
        case .board: "The board in every format"
        case .mockRoom: "Our call at every pick"
        case .player: "Every number with its basis"
        }
    }

    /// The file's stem, numbered in the listing's order as the Play set's.
    var stem: String {
        switch self {
        case .lineup: "1-lineup"
        case .waivers: "2-waivers"
        case .trades: "3-trades"
        case .matchup: "4-matchup"
        case .rankings: "5-rankings"
        case .board: "6-board"
        case .mockRoom: "7-mock-room"
        case .player: "8-player-page"
        }
    }

    /// The tab the bar lights: nil for a pushed page.
    var lit: String? {
        switch self {
        case .lineup: PhoneRail.lineupKey
        case .waivers: PhoneRail.waiversKey
        case .trades: PhoneRail.tradesKey
        case .matchup: PhoneRail.matchupKey
        case .rankings, .board, .mockRoom, .player: nil
        }
    }

    /// Whether the app draws its top bar and its tab bar around the screen: the mock room covers both.
    var chrome: Bool {
        self != .mockRoom
    }
}

/// The two iPhone sizes App Store Connect takes for an iPhone-only app (docs/store/2026-10-26-app-store-
/// listing.md §2): the medium Dynamic Island class (required) and the large one, each at 3x.
enum StoreDevice: String, CaseIterable, Sendable {
    /// 6.3-inch class, 1206 x 2622.
    case medium
    /// 6.9-inch class, 1320 x 2868.
    case large

    var device: SnapshotDevice {
        switch self {
        case .medium: .iPhone17Pro
        case .large: .iPhone17ProMax
        }
    }

    /// The pixels App Store Connect takes at this size.
    var pixels: (width: Int, height: Int) {
        (Int(device.width * device.scale), Int(device.height * device.scale))
    }

    func file(_ shot: StoreShot) -> String {
        "\(rawValue)-\(shot.stem).png"
    }
}
