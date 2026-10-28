import CommishAPI
import Foundation

/// Our board as an empty sheet starts from it (web/src/lib/server/sheet-board.ts sheetBoard, which the
/// site prerenders as data/sheet-board/<format>.json): the run's board for the sheet's format, its ranked
/// players in our order with each on a season-long list after the last available player at his
/// position, then its kickers and defenses in the drafts' order, each a row with no tier, tag or note.
public enum SheetStart {
    /// The rows our board starts a sheet with, or nil when the run has no board for the format.
    static func rows(
        _ api: any RunAPI, format: Components.Schemas.BoardFormatKnown
    ) async throws -> [SheetEntry]? {
        let manifest = try await RunBoardReader.resolve(api.manifest(tag: nil), kept: nil).value
        guard let run = manifest.formats.first(where: { sheetFormat($0) == format }) else {
            return nil
        }
        let read = try await RunBoardReader.read(api, format: run.id, kept: nil)
        let board = read.board.value
        let statuses = read.designations.value?.players.additionalProperties ?? [:]
        let ranked = BoardOrder.withStatuses(board.rows, statuses).map {
            entry(id: $0.id, name: $0.name, position: $0.positionName, team: $0.team, headshot: $0.headshot)
        }
        let market = BoardOrder.withStatuses(board.market, statuses).map {
            entry(id: $0.id, name: $0.name, position: $0.positionName, team: $0.team, headshot: $0.headshot)
        }
        return Array((ranked + market).prefix(SheetLimits.rows))
    }

    /// The sheet's format a run format reaches (format-ids.ts apiFormatOf): the league size the sheet keeps
    /// one board for, its id without the team count, hyphens read as underscores ("ppr-12" is "ppr").
    static func sheetFormat(_ format: RunFormat) -> Components.Schemas.BoardFormatKnown? {
        let suffix = "-\(defaultTeams)"
        guard format.teams == defaultTeams, format.id.hasSuffix(suffix) else {
            return nil
        }
        let name = format.id.dropLast(suffix.count).replacingOccurrences(of: "-", with: "_")
        return Components.Schemas.BoardFormatKnown(rawValue: name)
    }

    /// format-ids.ts DEFAULT_TEAMS.
    static let defaultTeams = 12

    /// A board row as a sheet row: his face where it is an https address the API takes, a defense's
    /// none (its club's chip is drawn, B245).
    private static func entry(id: String, name: String, position: String, team: String, headshot: String?)
        -> SheetEntry {
        let face = headshot
            .flatMap { position != "DST" && $0.hasPrefix("https://") && $0.count <= SheetLimits.headshot ? $0 : nil }
        return SheetEntry(
            id: id, name: name, position: position, team: team.isEmpty ? nil : team,
            headshot: face, tier: nil, tags: [], note: nil
        )
    }
}
