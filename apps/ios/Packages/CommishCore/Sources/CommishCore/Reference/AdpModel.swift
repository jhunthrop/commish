import CommishAPI
import CommishDesign
import Foundation

/// One row of ADP (AdpView.svelte's Row at 390 in the drafters' order): his ADP leading, the board row's
/// face, name, pill, club and bye, then where our board has him (Rk), his points, his value and the Gap.
public struct AdpRow: Equatable, Sendable, Identifiable {
    /// The board row the run gives him, his figures as the Board draws them.
    public let row: BoardRow
    /// His ADP, "12.4".
    public let adp: String
    /// Our rank, the list's word for a player on one ("IR"), the empty figure for a kicker or a
    /// defense, whom our board does not rank.
    public let rank: String

    public var id: String {
        row.id
    }
}

/// ADP for one format as the web's ADP page says it at 390 (server/pages/adp.ts, AdpView.svelte), from
/// the run (GET /run/manifest, /run/boards/{format}, /run/adp, /run/designations, /run/clubs): every
/// player the board carries an ADP for, in the order drafters take them (our rank breaking a tie),
/// beside where our board has him; a player the drafts have and the board does not is not drawn, nor
/// one the board has with no ADP. The format chips, the basis once, the verb to a mock.
public struct AdpModel: Equatable, Sendable {
    /// "2026 ADP".
    public let heading: String
    /// "Updated Oct 21".
    public let stamp: String
    /// The format as the manifest names it ("ppr-12").
    public let format: String
    public let formats: [BoardChip<String>]
    /// The Gap is drawn: the board compares drafters with our rank and a row carries the figure.
    public let gap: Bool
    public let rows: [AdpRow]
    /// "ADP from PPR drafts, Sep 9, earliest first.", our board, the Gap where drawn, the capture.
    public let basis: [String]
    public let verb: PageVerb

    public var heads: [String] {
        [Words.Board.adp, Words.Box.player, Words.Figure.projected, Words.Board.overReplShort]
            + (gap ? [Words.Board.gap] : [])
    }

    init(read: RunBoardRead, now: Date, zone: TimeZone) {
        let manifest = read.manifest.value
        let format = read.format
        let board = read.board.value
        let statuses = read.designations.value?.players.additionalProperties ?? [:]
        heading = "\(manifest.season) \(Words.AdpPage.heading)"
        stamp = RunWords.stamp(manifest)
        self.format = format.id
        formats = manifest.formats.map { BoardChip(label: $0.label, value: $0.id, pressed: $0.id == format.id) }
        let cells = BoardCells(
            statuses: statuses, byes: BoardCells.byes(read.clubs.value), fromWeek: format.rosFromWeek, zone: zone
        )
        let ranked = BoardOrder.withStatuses(board.rows, statuses).compactMap { row in
            row.adp.map { (adp: $0, ourRank: row.ourRank, row: cells.ranked(row), rank: Self.rank(row, statuses)) }
        }
        let market = BoardOrder.withStatuses(board.market, statuses).map { row in
            (adp: row.adp, ourRank: row.ourRank, row: cells.market(row, placed: true), rank: Words.Box.none)
        }
        // The drafters' order (adp.ts): earliest first, our rank breaking a tie, then as listed.
        rows = (ranked + market).enumerated()
            .sorted { ($0.element.adp, $0.element.ourRank, $0.offset) < ($1.element.adp, $1.element.ourRank, $1.offset)
            }
            .map { AdpRow(row: $0.element.row, adp: Formatting.fixed($0.element.adp), rank: $0.element.rank) }
        // format/gap.ts carriesGap over the rows drawn, as the run writes them.
        let carriesGap = board.rows.contains { $0.adp != nil && $0.gap != nil } || board.market
            .contains { $0.gap != nil }
        gap = format.rosFromWeek == nil && carriesGap
        let capture = read.designations.value.map {
            BoardWords.capture(asOf: $0.readAt, checkedAt: $0.checkedAt, now: now, zone: zone)
        }
        basis = Self.basis(format, season: manifest.season, sources: read.sources.value, gap: gap)
            + (capture.map { [$0] } ?? [])
        verb = .mock
    }

    /// held-places.ts rankShown: our rank, or the list's word.
    static func rank(_ row: RunBoardRow, _ statuses: BoardOrder.Statuses) -> String {
        guard let status = statuses[row.id], status.seasonLong, let known = status.status.value1 else {
            return String(row.ourRank)
        }
        return RowStatuses.rankWord(known)
    }

    /// board-basis.ts boardBasis in the drafters' order, the phone's parts.
    static func basis(_ format: RunFormat, season: Int, sources: [RunAdpSource], gap: Bool) -> [String] {
        let drafts = RunWords.adpDrafts(sources, format: format.id).joined(separator: " and ")
        return ["ADP from \(drafts), earliest first.", BoardBasis.ourBoard(format, season: season)]
            + (gap ? [Words.BoardBasis.gap] : [])
    }
}

public extension RunScreenViewModel where Model == AdpModel {
    /// ADP in `format` as the manifest names it, nil for the run's default.
    static func adp(
        format: String?, run: any RunAPI, pages: any RunPagesAPI, cache: any AnswerCache, clock: any Clock,
        zone: TimeZone = .current, onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> RunScreenViewModel<AdpModel> {
        RunScreenViewModel(
            reads: RunReads(run: run, pages: pages, cache: cache, clock: clock), zone: zone,
            onSignedOut: onSignedOut, build: AdpModel.build(format: format, clock: clock, zone: zone)
        )
    }

    /// The format the member last chose: the one asked for while its read is in flight, else the
    /// one shown.
    var chosenFormat: String? {
        if case let .adp(format)? = ask {
            return format
        }
        guard case let .loaded(model, _) = state else {
            return nil
        }
        return model.format
    }

    /// A format chip: ADP in that format, built on the newest choice so a tap during a read wins; a
    /// format whose board the run lacks leaves the screen shown, saying so.
    func choose(format: String) async {
        guard case let .loaded(model, _) = state, format != chosenFormat else {
            return
        }
        let label = model.formats.first { $0.value == format }?.label ?? format
        await rebuild(
            AdpModel.build(format: format, clock: clock, zone: zone), ask: .adp(format: format),
            absent: RunWords.absent(label)
        )
    }
}

extension AdpModel {
    /// The Board's read of the run (its manifest, the format's board, the ADP's sources, the capture and
    /// the clubs), each file kept under its own key.
    static func build(format: String?, clock: any Clock, zone: TimeZone) -> RunScreenViewModel<AdpModel>.Build {
        { reads in
            let manifest = try await reads.manifest()
            let formats = manifest.value.formats.map(\.id)
            guard let chosen = format.flatMap({ formats.contains($0) ? $0 : nil }) ?? formats.first else {
                throw RunReadError.noFormat
            }
            async let board = reads.board(chosen, manifest: manifest.value)
            async let sources = reads.sources()
            async let capture = reads.designations()
            async let clubs = reads.clubs()
            let (boardRead, sourcesRead, captureRead, clubsRead) = try await (board, sources, capture, clubs)
            let read = RunBoardRead(
                manifest: manifest.kept, board: boardRead.kept, sources: sourcesRead.kept,
                designations: captureRead?.kept ?? Kept(value: nil, tag: nil), clubs: clubsRead.kept
            )
            return BuiltScreen(
                model: AdpModel(read: read, now: clock.now, zone: zone),
                manifest: manifest.value,
                reads: [manifest.mark, boardRead.mark, sourcesRead.mark, clubsRead.mark] +
                    (captureRead.map { [$0.mark] } ?? [])
            )
        }
    }
}
