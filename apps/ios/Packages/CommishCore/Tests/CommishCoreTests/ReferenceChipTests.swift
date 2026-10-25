import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The reference screens' chips and picks (review M1 to M3): a format switch that reads its own board
/// and answers 304 the next time; a tap made while a read is in flight wins over the read it overtook;
/// a chip and a pick made close together both land; a format the run lacks leaves the screen shown,
/// saying so in the web's words.
@MainActor
struct ReferenceChipTests {
    private let folder = FileManager.default.temporaryDirectory
        .appendingPathComponent("commish-reference-chips-\(UUID().uuidString)")
    static let now = APIDecoding.parseDate("2026-10-22T17:00:00Z")!

    private func cache() -> FileCache {
        FileCache(folder: folder)
    }

    private func shown<Model>(_ viewModel: RunScreenViewModel<Model>) throws -> Model {
        guard case let .loaded(model, _) = viewModel.state else {
            throw ChipError.notLoaded("\(viewModel.state)")
        }
        return model
    }

    enum ChipError: Error {
        case notLoaded(String)
    }

    private func adp(_ run: any RunAPI, cache: FileCache, format: String? = nil) -> RunScreenViewModel<AdpModel> {
        .adp(
            format: format, run: run, pages: StubPages(.contract), cache: cache, clock: FixedClock(Self.now),
            zone: Fixtures.zone
        )
    }

    /// Waits until the gate holds a read, so the next tap is made while that read is in flight.
    private func untilHeld(_ gate: ReadGate) async {
        while await !gate.holding {
            await Task.yield()
        }
    }

    @Test func aFormatChipReadsThatFormatsBoardAndItsETagAnswers304NextTime() async throws {
        let run = SwitchingRun()
        let cache = cache()
        let viewModel = adp(run, cache: cache)
        await viewModel.load()
        let ppr = try shown(viewModel)
        #expect(ppr.format == "ppr-12")
        await viewModel.choose(format: "half-ppr-12")
        let half = try shown(viewModel)
        #expect(half.format == "half-ppr-12")
        #expect(half.formats.filter(\.pressed).map(\.value) == ["half-ppr-12"])
        #expect(half.rows.map(\.id) == ppr.rows.map(\.id), "the stub serves PPR's rows under Half PPR")
        #expect(viewModel.notice == nil)
        let boardsBefore = await run.unchangedBoards
        let again = adp(run, cache: cache, format: "half-ppr-12")
        await again.load()
        #expect(try shown(again).format == "half-ppr-12")
        #expect(await run.unchangedBoards == boardsBefore + 1, "the Half PPR board kept under its own key")
    }

    @Test func aChipTappedBackDuringAReadEndsOnTheLastTap() async throws {
        let gate = ReadGate(holding: "half-ppr-12")
        let viewModel = adp(SwitchingRun(gate: gate), cache: cache())
        await viewModel.load()
        let slow = Task { await viewModel.choose(format: "half-ppr-12") }
        await untilHeld(gate)
        #expect(viewModel.chosenFormat == "half-ppr-12", "the chip pressed while its read is in flight")
        // Back to PPR before Half PPR lands: the tap is not lost against the PPR still shown.
        await viewModel.choose(format: "ppr-12")
        #expect(try shown(viewModel).format == "ppr-12")
        await gate.release()
        await slow.value
        #expect(try shown(viewModel).format == "ppr-12", "the overtaken read is dropped")
        #expect(viewModel.chosenFormat == "ppr-12")
    }

    @Test func aChipAndAPickCloseTogetherBothLand() async throws {
        let gate = ReadGate(holding: "half-ppr-12")
        let viewModel = RunScreenViewModel.compare(
            slugs: ["jahmyr-gibbs", "josh-allen"], run: SwitchingRun(gate: gate), pages: StubPages(.contract),
            cache: cache(), clock: FixedClock(Self.now), zone: Fixtures.zone
        )
        await viewModel.load()
        // Compare reads no board, so the gate holds its ADP read in the chip's build.
        await gate.hold(adp: true)
        let slow = Task { await viewModel.choose(format: "half-ppr-12") }
        await untilHeld(gate)
        await viewModel.choose(slot: 1, slug: "josh-jacobs")
        let model = try shown(viewModel)
        #expect(model.format == "half-ppr-12")
        #expect(model.slugs == ["jahmyr-gibbs", "josh-jacobs"])
        await gate.release()
        await slow.value
        #expect(try shown(viewModel).slugs == ["jahmyr-gibbs", "josh-jacobs"])
    }

    @Test func aFormatTheRunLacksLeavesTheScreenShownSayingSo() async throws {
        let viewModel = adp(StubRun(.contract), cache: cache())
        await viewModel.load()
        // The contract run lists three formats and carries PPR's board alone (the API's 404).
        await viewModel.choose(format: "half-ppr-12")
        let model = try shown(viewModel)
        #expect(model.format == "ppr-12", "PPR stays shown, never a full-screen failure")
        #expect(model.formats.filter(\.pressed).map(\.value) == ["ppr-12"])
        #expect(viewModel.chosenFormat == "ppr-12")
        #expect(viewModel.notice == "Half PPR is not on our board yet")
        #expect(viewModel.staleWords == viewModel.notice)
        // A pull reads the screen that worked again, and clears the notice.
        await viewModel.load()
        #expect(try shown(viewModel).format == "ppr-12")
        #expect(viewModel.notice == nil)
    }

    @Test func theInterimReachCountsTheSidesPagesAndNamesNoWeekForAHeldSide() async throws {
        let run = RunFixture.contract
        let pages = try ["4429795", "3918298"].map { try run.page(id: $0) }
        let slates = try run.schedule().slates
        // The two pages fall short of the run's partial week (a week 6 game final on the schedule).
        let counted = RunReach.counted(pages, slates: slates, complete: 5)
        #expect(RunReach.words(counted) == "through week 5")
        #expect(RunReach.words(RunReach.finals(slates, complete: 5)).hasPrefix("through week 5 and week 6's"))
        // A side read from the board (a held page with no copy) names no week at all.
        let viewModel = RunScreenViewModel.compare(
            slugs: ["jahmyr-gibbs", "josh-allen"], run: StubRun(.contract),
            pages: StubPages(.contract, held: ["4429795": nil]), cache: cache(), clock: FixedClock(Self.now),
            zone: Fixtures.zone
        )
        await viewModel.load()
        guard case let .table(table) = try shown(viewModel).outcome else {
            Issue.record("expected the call")
            return
        }
        #expect(table.basis.contains("GP and Avg are this season's."))
    }

    @Test func absentWordsAreTheWebs() throws {
        let parity = try ReferenceParityTests.parity()
        #expect(RunWords.absent("Half PPR") == parity.absent)
    }
}

/// Holds one read until released: the board of `holding`, or, when armed, the next ADP read.
actor ReadGate {
    let format: String
    private var adpArmed = false
    private var waiting: CheckedContinuation<Void, Never>?
    private var released = false

    init(holding format: String) {
        self.format = format
    }

    var holding: Bool {
        waiting != nil
    }

    func hold(adp: Bool) {
        adpArmed = adp
    }

    func pass(board: String) async {
        guard board == format, !released else {
            return
        }
        await withCheckedContinuation { waiting = $0 }
    }

    func passADP() async {
        guard adpArmed else {
            return
        }
        adpArmed = false
        await withCheckedContinuation { waiting = $0 }
    }

    func release() {
        released = true
        waiting?.resume()
        waiting = nil
    }
}

/// The contract run with PPR's board served under every format its manifest lists (its format named
/// anew), so a format switch can be read; each file with its own ETag; a gate holding a read.
actor SwitchingRun: RunAPI {
    let run = StubRun(.contract)
    let gate: ReadGate?
    private(set) var unchangedBoards = 0

    init(gate: ReadGate? = nil) {
        self.gate = gate
    }

    func manifest(tag: String?) async throws -> RunRead<RunManifest> {
        try await run.manifest(tag: tag)
    }

    func board(format: String, tag: String?) async throws -> RunRead<RunBoardAnswer> {
        await gate?.pass(board: format)
        let current = try run.fixture.tag("boards/\(format).json")
        guard tag != current else {
            unchangedBoards += 1
            return .unchanged(tag: current)
        }
        let ppr = try run.fixture.board(format: "ppr-12")
        return .fresh(
            RunBoardAnswer(runId: ppr.runId, format: format, rows: ppr.rows, market: ppr.market),
            tag: current
        )
    }

    func adpSources(tag: String?) async throws -> RunRead<[RunAdpSource]> {
        await gate?.passADP()
        return try await run.adpSources(tag: tag)
    }

    func designations(tag: String?) async throws -> RunRead<RunDesignations?> {
        try await run.designations(tag: tag)
    }

    func clubs(tag: String?) async throws -> RunRead<[RunClub]> {
        try await run.clubs(tag: tag)
    }
}
