import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The reference screens held to the web's (shared/fixtures/parity/reference.json), over the two
/// fixture runs through the view models and the run's routes: ADP in every format the run carries
/// (the drafters' order, each row's ADP, Rk, Gap and tint, the basis, the drafts' players the board
/// lacks and the board's with no ADP left out), every pair Compare can set from the run's pages in
/// every format (the call, the evidence, the rows with their better side and tone, the basis) and a
/// held pair, the clubs index, every club's page and the strength of schedule grid.
@MainActor
struct ReferenceParityTests {
    static func parity() throws -> Parity {
        try JSONDecoder().decode(Parity.self, from: Fixtures.data("fixtures/parity/reference.json"))
    }

    private static func cache() -> FileCache {
        FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("commish-reference-parity-\(UUID().uuidString)"))
    }

    static func reads(_ run: Run) -> (RunReads, FixedClock) {
        let clock = FixedClock(APIDecoding.parseDate(run.now)!)
        return (RunReads(run: StubRun(run.run), pages: StubPages(run.run), cache: cache(), clock: clock), clock)
    }

    static func loaded<Model>(_ viewModel: RunScreenViewModel<Model>) async throws -> Model {
        await viewModel.load()
        guard case let .loaded(model, _) = viewModel.state else {
            throw ParityError.notLoaded("\(viewModel.state)")
        }
        return model
    }

    enum ParityError: Error {
        case notLoaded(String)
    }

    /// A game by its club and week.
    static func at(_ abbr: String, _ week: Int) -> String {
        "\(abbr) \(week)"
    }

    /// The current week's game words by club and week, in the fixtures' zone.
    static func states(_ run: Run) -> [String: String] {
        Dictionary(uniqueKeysWithValues: run.states.map { (at($0.abbr, $0.week), $0.word) })
    }

    @Test func theContractRunSaysItsCurrentWeeksStatesTheStandInNone() throws {
        let runs = try Self.parity().runs
        #expect(runs.filter { $0.fixture.hasSuffix("standin-run") }
            .allSatisfy { $0.states.isEmpty && $0.current == nil })
        let contract = try #require(runs.first { !$0.fixture.hasSuffix("standin-run") })
        #expect(contract.current?.week == 6)
        #expect(Set(contract.states.map(\.word)) == [Words.Kickoff.final, Words.Kickoff.kickedOff])
        // A played bye's club says its code alone (KC's week 5 before the week 7 board).
        #expect(contract.clubs.clubs.first { $0.abbr == "KC" }?.meta == "KC")
    }

    @Test func adpDrawsTheWebsRowsInTheDraftersOrderWithItsBasis() async throws {
        for run in try Self.parity().runs {
            for want in run.adp {
                let (reads, clock) = Self.reads(run)
                let model = try await Self.loaded(RunScreenViewModel(
                    reads: reads, zone: Fixtures.zone, onSignedOut: {},
                    build: AdpModel.build(format: want.format, clock: clock, zone: Fixtures.zone)
                ))
                #expect(model.format == want.format)
                #expect(model.gap == want.gap, "\(run.fixture) \(want.format)")
                #expect(model.rows.map(\.id) == want.rows.map(\.id), "\(run.fixture) \(want.format) order")
                for (row, wanted) in zip(model.rows, want.rows) {
                    #expect(row.adp == wanted.adp, "\(wanted.id)")
                    #expect(row.rank == wanted.rank, "\(wanted.id)")
                    #expect(row.row.gap == wanted.gap, "\(wanted.id)")
                    #expect((wanted.heat == nil ? nil : row.row.heat.name) == wanted.heat, "\(wanted.id)")
                }
                // The basis, then the capture's sentence where the run carries one.
                #expect(Array(model.basis.prefix(want.basis.count)) == want.basis)
                #expect(try model.basis.count - want.basis.count == (run.run.designations() == nil ? 0 : 1))
                // Review Focus: the drafts' players the board does not carry, and the board's with no ADP,
                // are not drawn, as the web draws neither.
                let shown = Set(model.rows.map(\.id))
                #expect(want.sourcesOnly.allSatisfy { !shown.contains($0) })
                #expect(want.noAdp.allSatisfy { !shown.contains($0) })
            }
        }
    }

    @Test func theContractRunHasPlayersTheDraftsHaveAndTheBoardDoesNot() throws {
        let contract = try #require(Self.parity().runs.first { !$0.fixture.hasSuffix("standin-run") })
        #expect(contract.adp.first?.sourcesOnly.isEmpty == false, "the case the Review Focus asks for")
        let standIn = try #require(Self.parity().runs.first { $0.fixture.hasSuffix("standin-run") })
        #expect(standIn.adp.first?.noAdp.isEmpty == false, "and its reverse")
    }

    @Test func compareSetsEveryPairAsTheWebDoes() async throws {
        for run in try Self.parity().runs {
            let index = try run.run.indexEntries()
            let slug = { (id: String) in index.first { $0.id == id }?.slug }
            for want in run.compare.pairs {
                let (reads, _) = Self.reads(run)
                let ask = CompareAsk(
                    slugs: [slug(want.first), slug(want.second)],
                    format: want.format,
                    leagueFormat: nil
                )
                let model = try await Self.loaded(RunScreenViewModel(
                    reads: reads, zone: Fixtures.zone, onSignedOut: {}, build: CompareReader.build(
                        ask,
                        zone: Fixtures.zone
                    )
                ))
                let label = "\(run.fixture) \(want.first) \(want.second) \(want.format)"
                #expect(model.lead == nil, "\(label)")
                let ranked = try #require(run.run.manifest().formats.first { $0.id == want.format })
                let stamp = [LiveOrderWords.runStamp(ranked, zone: Fixtures.zone)].compactMap(\.self)
                Self.expect(model.outcome, equals: want, label: label, stamp: stamp)
            }
        }
    }

    /// `stamp` is the run's stamp an in-season pair's basis ends with while the order is unread
    /// (Lane 224, basisAtClock), after the basis the parity holds.
    static func expect(_ outcome: CompareOutcome, equals want: PairCase, label: String, stamp: [String]) {
        switch outcome {
        case .same:
            #expect(want.kind == "same", "\(label)")
        case .none:
            Issue.record("no outcome for \(label)")
        case let .table(table):
            #expect(want.kind == "call", "\(label)")
            #expect(table.heads.first?.id == want.leader, "\(label)")
            #expect(table.call == want.call, "\(label)")
            #expect(table.evidence == want.evidence, "\(label)")
            #expect(table.basis == want.basis.map { $0 + stamp }, "\(label)")
            let rows = want.rows ?? []
            #expect(table.rows.map(\.label) == rows.map(\.label), "\(label)")
            for (row, wanted) in zip(table.rows, rows) {
                #expect(row.range == wanted.range, "\(label) \(wanted.label)")
                #expect(row.cells.map(\.text) == wanted.cells.map(\.text), "\(label) \(wanted.label)")
                #expect(row.cells.map(\.wins) == wanted.cells.map(\.wins), "\(label) \(wanted.label)")
                #expect(row.cells.map { Self.tone($0.tone) } == wanted.cells.map(\.tone), "\(label) \(wanted.label)")
            }
        }
    }

    static func tone(_ tone: GapTone?) -> String? {
        switch tone {
        case .gain?: "gain"
        case .loss?: "loss"
        case .even?: "even"
        case nil: nil
        }
    }

    @Test func aPlayerOnASeasonLongListLosesTheCallAsOnTheWeb() throws {
        for run in try Self.parity().runs {
            let capture = try run.run.designations()
            let season = try run.run.manifest().season
            let manifest = try run.run.manifest()
            let clubs = try run.run.clubs()
            let index = try run.run.indexEntries()
            for want in run.compare.held {
                let player = { (id: String, held: Bool) throws -> ComparePlayer in
                    let entry = try #require(index.first { $0.id == id })
                    let status: RunPlayerStatus? = held
                        ? RunPlayerStatus(status: .init(value1: .injuredReserve), seasonLong: true, since: nil)
                        : capture?.players.additionalProperties[id]
                    return try ComparePlayer(run.run.page(id: id), entry: entry).with(status: status, season: season)
                }
                let format = try #require(manifest.formats.first { $0.id == want.format })
                let input = try CompareInput(
                    manifest: manifest, format: format, sources: run.run.adpSources(), clubs: clubs,
                    underway: run.underway, zone: Fixtures.zone, reach: .none, scoring: format.label, index: index,
                    sides: [.player(player(want.first, true)), .player(player(want.second, false))]
                )
                let model = CompareModel(input)
                guard case let .table(table) = model.outcome else {
                    Issue.record("no call for the held pair")
                    continue
                }
                #expect(table.call == want.call)
                #expect(table.evidence == want.evidence)
                #expect(table.rows.prefix(2).map { $0.cells.map(\.text) } == want.rows?.prefix(2)
                    .map { $0.cells.map(\.text) })
                #expect(table.rows.prefix(2).allSatisfy { $0.cells.allSatisfy { $0.wins == nil } })
            }
        }
    }

    @Test func compareSaysItsFirstStepsAndItsBasisAsTheWebDoes() async throws {
        for run in try Self.parity().runs {
            #expect(CompareModel.firstStep(0) == run.compare.steps.none)
            #expect(CompareModel.firstStep(1) == run.compare.steps.one)
            for (format, basis) in run.compare.basis {
                let (reads, _) = Self.reads(run)
                let index = try run.run.indexEntries()
                // Two pages set: the basis under the table with a Gap row where the run carries one.
                let slugs = index.prefix(2).map(\.slug)
                let model = try await Self.loaded(RunScreenViewModel(
                    reads: reads, zone: Fixtures.zone, onSignedOut: {},
                    build: CompareReader.build(
                        CompareAsk(slugs: slugs, format: format, leagueFormat: nil),
                        zone: Fixtures.zone
                    )
                ))
                guard case let .table(table) = model.outcome else {
                    Issue.record("no table in \(format)")
                    continue
                }
                let gapless = basis.filter { $0 != Words.BoardBasis.gap }
                // Exactly the one basis the table prints: the Gap's sentence only beside a Gap row.
                let gapRow = table.rows.contains { $0.label == CompareRows.gapLabel }
                // In season the run's stamp follows while the order is unread (Lane 224, basisAtClock).
                let ranked = try #require(run.run.manifest().formats.first { $0.id == format })
                let stamp = [LiveOrderWords.runStamp(ranked, zone: Fixtures.zone)].compactMap(\.self)
                #expect(table.basis == (gapRow ? basis : gapless) + stamp, "\(run.fixture) \(format)")
                #expect(gapRow == basis.contains(Words.BoardBasis.gap), "a format that compares draws the Gap")
            }
        }
    }

    @Test func theClubsIndexLeadsAndListsEveryClubAsTheWebDoes() async throws {
        for run in try Self.parity().runs {
            let (reads, _) = Self.reads(run)
            let model = try await Self.loaded(RunScreenViewModel(
                reads: reads, zone: Fixtures.zone, onSignedOut: {}, build: { reads in
                    let files = try await ClubFiles.read(reads, sources: false)
                    return BuiltScreen(
                        model: ClubsModel(files, zone: Fixtures.zone),
                        manifest: files.manifest.value,
                        reads: []
                    )
                }
            ))
            #expect(model.lead == run.clubs.lead)
            #expect(model.clubs.map(\.abbr) == run.clubs.clubs.map(\.abbr))
            for (card, wanted) in zip(model.clubs, run.clubs.clubs) {
                #expect(card.name == wanted.name)
                #expect(card.meta == wanted.meta)
                #expect(card.strength.map { Figure(value: $0.value, caption: $0.caption) } == wanted.strength)
                #expect(card.lead?.sheetPlayer.id == wanted.lead, "\(wanted.abbr)")
                #expect(card.players == wanted.players)
            }
        }
    }

    @Test func everyClubsPageSaysItsHeroGamesRowsAndBasisAsTheWebDoes() async throws {
        for run in try Self.parity().runs {
            let (reads, clock) = Self.reads(run)
            let files = try await ClubFiles.read(reads, sources: true)
            #expect(files.underway == run.underway)
            #expect(files.played.complete == run.played.complete)
            #expect(files.played.partial?.days == run.played.partial?.days)
            let capture = try run.run.designations() == nil ? 0 : 1
            for want in run.clubPages {
                let model = try #require(ClubPageModel(
                    files,
                    abbr: want.abbr.lowercased(),
                    now: clock.now,
                    zone: Fixtures.zone
                ))
                #expect(model.hero?.value == want.hero?.value, "\(want.abbr)")
                #expect(model.hero?.caption == want.hero?.caption)
                #expect(model.hero?.note == want.hero?.note)
                #expect(model.hero?.hardest == want.hero?.hardest.figure)
                #expect(model.hero?.hardestCaption == want.hero?.hardest.caption)
                #expect(model.scheduleCaption == want.scheduleCaption, "\(want.abbr)")
                #expect(model.games.map(\.week) == want.games.map(\.week))
                #expect(model.games.map(\.opponent) == want.games.map(\.opponent))
                #expect(model.games.map(\.value) == want.games.map(\.value))
                #expect(model.games.map(\.played) == want.games.map(\.played), "\(want.abbr)")
                let states = Self.states(run)
                #expect(model.games.map(\.state) == model.games.map { states[Self.at(want.abbr, $0.week)] })
                #expect(model.asOf == run.asOf, "\(want.abbr)")
                #expect(model.meta == want.meta, "\(want.abbr)")
                #expect(model.boardHead == run.clubHead.board, "\(want.abbr)")
                #expect(model.boardLabel == "\(model.name), \(run.clubHead.board)", "\(want.abbr)")
                // Both halves of the head against the web's words (the Lane 232 review's L3).
                let board = ClubFiles.head(files.format, atClock: false)
                let order = ClubFiles.head(files.format, atClock: true)
                #expect(board.title == run.clubHead.board)
                #expect(board.nobody == run.clubHead.nobodyBoard)
                #expect(order.title == run.clubHead.order)
                #expect(order.nobody == run.clubHead.nobodyOrder)
                #expect(model.rows.map(\.id) == want.rows, "\(want.abbr)")
                #expect(model.market.map(\.id) == want.market, "\(want.abbr)")
                #expect(model.columns == .ranked(gap: want.gap))
                #expect((model.compare?.ids ?? []) == (want.pair.count == 2 ? want.pair : []))
                #expect(Array(model.basis.prefix(want.basis.count)) == want.basis, "\(want.abbr)")
                let stamp = LiveOrderWords.runStamp(files.format, zone: Fixtures.zone) == nil ? 0 : 1
                #expect(model.basis.count == want.basis.count + capture + stamp)
            }
        }
    }

    @Test func theScheduleGridIsTheWebsCellForCell() async throws {
        for run in try Self.parity().runs {
            let (reads, _) = Self.reads(run)
            let files = try await ClubFiles.read(reads, sources: false)
            let model = ScheduleModel(files, zone: Fixtures.zone)
            let want = run.schedule
            let states = Self.states(run)
            #expect(model.grid.current == run.current?.week)
            #expect(model.grid.asOf == run.asOf)
            #expect(model.grid.lead == want.lead)
            #expect(model.grid.strengthLabel == want.strengthLabel)
            #expect(model.grid.played == want.played)
            #expect(model.grid.weeks == want.weeks)
            #expect(model.legendHard == want.legendHard)
            #expect(model.grid.rows.map(\.abbr) == want.rows.map(\.abbr))
            for (row, wanted) in zip(model.grid.rows, want.rows) {
                #expect(row.name == wanted.name)
                #expect(row.faceName == wanted.face?.name)
                #expect(row.rank == wanted.rank)
                #expect(row.strength == wanted.strength)
                #expect(row.cells.map(\.club) == wanted.cells.map(\.opponent), "\(wanted.abbr)")
                #expect(row.cells.map(\.value) == wanted.cells.map(\.value))
                #expect(row.cells.map(\.hard) == wanted.cells.map(\.hard))
                #expect(row.cells.map(\.played) == wanted.cells.map(\.played), "\(wanted.abbr)")
                #expect(row.cells.map(\.state) == row.cells.map { states[Self.at(row.abbr, $0.week)] }, "\(row.abbr)")
                let opponents = wanted.cells.map { cell in
                    cell.opponent.map { "\(cell.home ? Words.ClubPage.home : Words.ClubPage.away) \($0)" }
                }
                #expect(row.cells.map(\.opponent) == opponents)
            }
        }
    }
}
