import CommishAPI
import Foundation

/// What Compare is asked for: the two sides by their pages' slugs (the web's ?a= and ?b=) and the format.
struct CompareAsk: Equatable, Sendable {
    let slugs: [String?]
    /// The format as the manifest names it; nil for the followed league's where the run carries it,
    /// else the run's default.
    let format: String?
    /// The followed league's board as the run names it ("half-ppr-12"), nil with none.
    let leagueFormat: String?

    func with(slot: Int, slug: String?) -> CompareAsk {
        var slugs = slugs
        slugs[slot] = slug
        return CompareAsk(slugs: slugs, format: format, leagueFormat: leagueFormat)
    }

    func with(format: String) -> CompareAsk {
        CompareAsk(slugs: slugs, format: format, leagueFormat: leagueFormat)
    }

    /// format-ids.ts runFormatId: "half_ppr" at 12 teams is the run's "half-ppr-12".
    static func runFormat(_ league: FollowedLeague?) -> String? {
        league?.format.map { "\($0.rawValue.replacingOccurrences(of: "_", with: "-"))-12" }
    }
}

public extension RunScreenViewModel where Model == CompareModel {
    /// Compare with the sides the address sets (its ?a= and ?b=, the pages' slugs), in the followed
    /// league's format where the run carries it.
    static func compare(
        slugs: [String?], league: FollowedLeague? = nil, run: any RunAPI, pages: any RunPagesAPI,
        cache: any AnswerCache, clock: any Clock, zone: TimeZone = .current,
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) -> RunScreenViewModel<CompareModel> {
        let ask = CompareAsk(slugs: slugs, format: nil, leagueFormat: CompareAsk.runFormat(league))
        return RunScreenViewModel(
            reads: RunReads(run: run, pages: pages, cache: cache, clock: clock), zone: zone,
            onSignedOut: onSignedOut, build: CompareReader.build(ask)
        )
    }

    /// A player picked for a side (0 the first, 1 the second), or the side cleared with nil.
    func choose(slot: Int, slug: String?) async {
        guard let current = compareAsk, current.slugs.indices.contains(slot) else {
            return
        }
        let wanted = current.with(slot: slot, slug: slug)
        await rebuild(CompareReader.build(wanted), ask: .compare(wanted))
    }

    /// A format chip: the same two in that format.
    func choose(format: String) async {
        guard let current = compareAsk, current.format != format, case let .loaded(model, _) = state else {
            return
        }
        let wanted = current.with(format: format)
        let label = model.formats.first { $0.value == format }?.label ?? format
        await rebuild(CompareReader.build(wanted), ask: .compare(wanted), absent: RunWords.absent(label))
    }

    /// The format the member last chose, pressed on the chips while its read is in flight.
    var chosenFormat: String? {
        compareAsk?.format
    }

    /// The member's newest ask: the one in flight, else the screen shown's.
    private var compareAsk: CompareAsk? {
        if case let .compare(asked)? = ask {
            return asked
        }
        guard case let .loaded(model, _) = state else {
            return nil
        }
        return CompareAsk(slugs: model.slugs, format: model.format, leagueFormat: nil)
    }
}

/// Compare's reads: the manifest, the index, the ADP's sources, the clubs, the schedule and the capture,
/// then each side's page as the web's reader finds it.
enum CompareReader {
    static func build(_ ask: CompareAsk) -> RunScreenViewModel<CompareModel>.Build {
        { reads in
            let manifest = try await reads.manifest()
            async let index = reads.index()
            async let sources = reads.sources()
            async let clubs = reads.clubs()
            async let schedule = reads.schedule()
            async let capture = reads.designations()
            let (indexRead, sourcesRead, clubsRead, scheduleRead, captureRead) = try await (
                index, sources, clubs, schedule, capture
            )
            let formats = manifest.value.formats
            let chosen = [ask.format, ask.leagueFormat].compactMap(\.self)
                .first { id in formats.contains { $0.id == id } }
            guard let format = formats.first(where: { $0.id == chosen }) ?? formats.first else {
                throw RunReadError.noFormat
            }
            var marks = [manifest.mark, indexRead.mark, sourcesRead.mark, clubsRead.mark, scheduleRead.mark]
                + (captureRead.map { [$0.mark] } ?? [])
            var sides: [ReadSide] = []
            for slug in ask.slugs {
                try await sides.append(side(slug, reads: reads, index: indexRead.value, manifest: manifest.value))
            }
            marks += sides.flatMap(\.marks)
            let pages = sides.compactMap(\.page)
            let players = found(sides, capture: captureRead?.value, season: manifest.value.season)
            let underway = RunReach.underway(manifest.value, schedule: scheduleRead.value)
            let (complete, completeMarks) = try await completeWeek(
                pages,
                reads: reads,
                index: indexRead.value,
                manifest: manifest.value
            )
            marks += completeMarks
            let scored = pages.first.flatMap { page in formats.first { $0.id == page.season.format } }
            let scoring = scored?.label ?? format.label
            let input = CompareInput(
                manifest: manifest.value, format: format, sources: sourcesRead.value, clubs: clubsRead.value,
                underway: underway,
                reach: heldSide(sides) ? .none
                    : RunReach.counted(pages, slates: scheduleRead.value.slates, complete: complete),
                scoring: scoring, index: indexRead.value, sides: players
            )
            return BuiltScreen(model: CompareModel(input), manifest: manifest.value, reads: marks)
        }
    }

    /// Each side found, a player with his status on the capture and last season's line.
    private static func found(_ sides: [ReadSide], capture: RunDesignations?, season: Int) -> [CompareFound] {
        let statuses = capture?.players.additionalProperties ?? [:]
        return sides.map { side -> CompareFound in
            guard case let .player(player) = side.found else {
                return side.found
            }
            return .player(player.with(status: statuses[player.id], season: season))
        }
    }

    /// A side read from a held copy or the board has no log of his own to count, so the basis names no
    /// week rather than one his cells may pass (review L1).
    static func heldSide(_ sides: [ReadSide]) -> Bool {
        sides.contains { side in
            if case .player = side.found {
                return side.page == nil
            }
            return false
        }
    }

    /// The run's complete week: an own page's through week, the run's first own page's when neither
    /// side has one.
    private static func completeWeek(
        _ pages: [RunPlayer], reads: RunReads, index: [RunIndexEntry], manifest: RunManifest
    ) async throws -> (Int, [ReadMark]) {
        if let page = pages.first {
            return (page.season.through, [])
        }
        let (complete, marks) = try await reads.complete(index, manifest: manifest)
        return (complete ?? 0, marks)
    }

    /// A side by its slug: nobody asked, a slug the index does not name (or a page the run cannot
    /// give), or his page as the web's reader finds it.
    private static func side(
        _ slug: String?, reads: RunReads, index: [RunIndexEntry], manifest: RunManifest
    ) async throws -> ReadSide {
        guard let slug else {
            return ReadSide(found: .open, page: nil, marks: [])
        }
        guard let entry = index.first(where: { $0.slug == slug }) else {
            return ReadSide(found: .missing, page: nil, marks: [])
        }
        let (source, marks) = try await reads.lookup.source(entry, manifest: manifest)
        switch source {
        case let .page(player)?:
            return ReadSide(found: .player(ComparePlayer(player, entry: entry)), page: player, marks: marks)
        case let .copy(player, _)?:
            return ReadSide(found: .player(ComparePlayer(player, entry: entry)), page: nil, marks: marks)
        case let .facts(entry, row)?:
            let player = ComparePlayer(entry, row: row, format: manifest.formats.first?.id)
            return ReadSide(found: .player(player), page: nil, marks: marks)
        case nil:
            return ReadSide(found: .missing, page: nil, marks: marks)
        }
    }

    /// A side as read: what it found, his own page where the run gave one (its season counts toward
    /// the reach), and the reads it took.
    struct ReadSide {
        let found: CompareFound
        let page: RunPlayer?
        let marks: [ReadMark]
    }
}

extension ComparePlayer {
    init(_ player: RunPlayer, entry: RunIndexEntry) {
        id = player.id
        slug = player.slug
        name = player.name
        position = player.position.value1?.rawValue ?? player.position.value2 ?? ""
        team = player.team
        headshot = BoardCells.face(player.headshot)
        formats = player.formats.additionalProperties.mapValues(CompareNumbers.init)
        status = nil
        seasonSoFar = (entry.season.games, entry.season.pointsPerGame)
        lastSeasonPerGame = nil
        priorSeasons = player.priorSeasons ?? []
    }

    /// A held page with no copy: the board's figures in the leading format and no earlier season.
    init(_ entry: RunIndexEntry, row: RunBoardRow, format: String?) {
        id = entry.id
        slug = entry.slug
        name = entry.name
        position = entry.position.value1?.rawValue ?? entry.position.value2 ?? ""
        team = entry.team
        headshot = BoardCells.face(entry.headshot)
        formats = format.map { [$0: CompareNumbers(row)] } ?? [:]
        status = nil
        seasonSoFar = (entry.season.games, entry.season.pointsPerGame)
        lastSeasonPerGame = nil
        priorSeasons = []
    }

    /// His status on the capture and last season's points a game, the run's season less one.
    func with(status: RunPlayerStatus?, season: Int) -> ComparePlayer {
        ComparePlayer(
            id: id, slug: slug, name: name, position: position, team: team, headshot: headshot, formats: formats,
            status: status, seasonSoFar: seasonSoFar,
            lastSeasonPerGame: priorSeasons.first { $0.season == season - 1 }?.pointsPerGame,
            priorSeasons: priorSeasons
        )
    }
}
