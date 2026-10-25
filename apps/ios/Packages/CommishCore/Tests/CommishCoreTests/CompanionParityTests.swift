import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The companion's port held to the web's page at 390 (shared/fixtures/parity/companion.json), through
/// the view model over the recorded replay read in order as the page reads it: per moment the bar, the
/// notes, the strip of picks as they land, at the turn the picks since and the call with the shortlist,
/// between turns the call that waits on the board, the pool under every chip with its basis and
/// chances, and the team; the report; the followed drafts' lines; and the sentences the replay never
/// reaches over edited copies of a recorded answer.
@MainActor
struct CompanionParityTests {
    typealias JSON = [String: Any]

    static let parity: JSON = {
        guard let data = try? Fixtures.data("fixtures/parity/companion.json"),
              let object = try? JSONSerialization.jsonObject(with: data) as? JSON
        else {
            preconditionFailure("shared/fixtures/parity/companion.json does not read")
        }
        return object
    }()

    static func web(_ moment: CompanionFixture.Moment) throws -> JSON {
        let moments = try #require(parity["moments"] as? JSON)
        return try #require(moments[moment.rawValue] as? JSON)
    }

    /// The view model after reading every moment up to `moment`, in order.
    static func viewModel(through moment: CompanionFixture.Moment) async -> CompanionViewModel {
        let all = CompanionFixture.Moment.allCases
        let read = Array(all.prefix(through: all.firstIndex(of: moment) ?? 0))
        let viewModel = CompanionViewModel(
            id: CompanionFixture.id, api: StubCompanion(moments: read), cache: companionCache(),
            clock: FixedClock(Date(timeIntervalSince1970: 1_792_000_000))
        )
        for _ in read {
            await viewModel.load()
        }
        return viewModel
    }

    static func room(through moment: CompanionFixture.Moment) async throws -> (CompanionViewModel, CompanionModel) {
        let viewModel = await viewModel(through: moment)
        guard case let .room(model, _) = viewModel.state else {
            Issue.record("\(moment) did not draw the room: \(viewModel.state)")
            throw ParityError.notRoom
        }
        return (viewModel, model)
    }

    enum ParityError: Error {
        case notRoom
    }

    /// The moments the room is drawn at: once the draft is over the report takes the screen.
    nonisolated static let roomMoments: [CompanionFixture.Moment] = [.waiting, .between, .turn, .taken]

    @Test(arguments: roomMoments)
    func theBarIsTheWebs(moment: CompanionFixture.Moment) async throws {
        let (_, model) = try await Self.room(through: moment)
        let web = try Self.web(moment)
        let bar = try #require(web["bar"] as? JSON)
        #expect(model.bar.figure == bar["figure"] as? String)
        #expect(model.bar.caption == bar["caption"] as? String)
        #expect(model.bar.section == bar["section"] as? String)
        #expect(model.bar.title == bar["title"] as? String)
        #expect(model.bar.league == bar["league"] as? String)
        #expect(model.bar.turn == bar["turn"] as? String)
        #expect(model.bar.onTurn == bar["onTurn"] as? Bool)
        #expect(model.bar.stale == bar["stale"] as? String)
        #expect(model.bar.open == bar["open"] as? String)
        #expect(model.bar.openURL?.absoluteString == bar["openURL"] as? String)
        #expect(model.notes == web["notes"] as? [String])
        #expect(model.lost == web["lost"] as? String)
        #expect(model.names == web["names"] as? [String])
    }

    @Test(arguments: roomMoments)
    func theStripsAreTheWebs(moment: CompanionFixture.Moment) async throws {
        let (_, model) = try await Self.room(through: moment)
        let web = try Self.web(moment)
        Self.expectStrip(model.strip, web["strip"] as? JSON, named: "strip")
        Self.expectStrip(model.since, web["since"] as? JSON, named: "since")
    }

    static func expectStrip(_ strip: PickStripModel?, _ web: JSON?, named: String) {
        guard let web else {
            #expect(strip == nil, "\(named) is drawn where the web draws none")
            return
        }
        guard let strip else {
            Issue.record("\(named) is not drawn where the web draws one")
            return
        }
        #expect(strip.lead == web["lead"] as? String)
        #expect(strip.lines == web["lines"] as? [String])
        let picks = web["picks"] as? [JSON] ?? []
        #expect(strip.picks.map(\.player.id) == picks.map { $0["id"] as? String ?? "" })
        #expect(strip.picks.map(\.name) == picks.map { $0["name"] as? String ?? "" })
        #expect(strip.picks.map(\.lines) == picks.map { $0["lines"] as? [String] ?? [] })
        if !picks.isEmpty, picks[0]["newest"] != nil {
            #expect(strip.picks.map(\.newest) == picks.map { $0["newest"] as? Bool ?? false })
            #expect(strip.picks.map(\.strong) == picks.map { $0["strong"] as? Bool ?? false })
        }
    }

    @Test(arguments: roomMoments)
    func theCallAndTheShortlistAreTheWebs(moment: CompanionFixture.Moment) async throws {
        let (_, model) = try await Self.room(through: moment)
        let web = try Self.web(moment)
        if let call = web["call"] as? JSON {
            let ours = try #require(model.call)
            #expect(ours.tag == call["tag"] as? String)
            #expect(ours.chanceHead == call["chanceHead"] as? String)
            #expect(ours.verb == call["verb"] as? String)
            #expect(ours.waiting == call["waiting"] as? Bool)
            let rows = call["rows"] as? [JSON] ?? []
            #expect(ours.rows.map(\.player.id) == rows.map { $0["id"] as? String ?? "" })
            #expect(ours.rows.map(\.player.pill) == rows.map { $0["pill"] as? String ?? "" })
            #expect(ours.rows.map(\.value) == rows.map { $0["value"] as? String ?? "" })
            #expect(ours.rows.map(\.chance) == rows.map { $0["chance"] as? String ?? "" })
        } else {
            #expect(model.call == nil)
        }
        if let shortlist = web["shortlist"] as? [JSON] {
            let ours = try #require(model.shortlist)
            #expect(ours.map(\.player.id) == shortlist.map { $0["id"] as? String ?? "" })
            #expect(ours.map(\.chance) == shortlist.map { $0["chance"] as? String })
            #expect(ours.map(\.label) == shortlist.map { $0["label"] as? String ?? "" })
        } else {
            #expect(model.shortlist == nil)
        }
    }

    @Test(arguments: roomMoments)
    func thePoolUnderEveryChipIsTheWebs(moment: CompanionFixture.Moment) async throws {
        let (viewModel, model) = try await Self.room(through: moment)
        let pool = try #require(Self.web(moment)["pool"] as? JSON)
        let ours = try #require(model.pool)
        #expect(ours.line == pool["line"] as? String)
        #expect(ours.basis == pool["basis"] as? String)
        #expect(ours.chanceHead == pool["chanceHead"] as? String)
        #expect(ours.chanceLabel == pool["chanceLabel"] as? String)
        #expect(ours.missing == pool["missing"] as? String)
        for view in pool["views"] as? [JSON] ?? [] {
            let filter = try #require(view["filter"] as? String)
            viewModel.choose(filter: filter)
            guard case let .room(chosen, _) = viewModel.state, let rows = chosen.pool?.rows else {
                Issue.record("\(filter) drew no pool")
                continue
            }
            let first = Array(rows.prefix(PoolModel.firstRows))
            let web = view["rows"] as? [JSON] ?? []
            #expect(rows.count == view["count"] as? Int, "\(moment) \(filter)")
            #expect(chosen.pool?.empty == view["empty"] as? String)
            let more = rows.count > PoolModel.firstRows
                ? RoomWords.showMore(min(PoolModel.moreRows, rows.count - PoolModel.firstRows)) : nil
            #expect(more == view["more"] as? String)
            #expect(first.map(\.player.id) == web.map { $0["id"] as? String ?? "" }, "\(moment) \(filter)")
            #expect(first.map(\.player.pill) == web.map { $0["pill"] as? String ?? "" })
            #expect(first.map(\.value) == web.map { ($0["value"] as? JSON)?["text"] as? String ?? "" })
            #expect(first.map { $0.heat?.name } == web.map { ($0["value"] as? JSON)?["heat"] as? String })
            #expect(first.map(\.chance) == web.map { $0["chance"] as? String })
            #expect(first.map(\.isCall) == web.map { $0["call"] as? Bool ?? false })
        }
    }

    @Test(arguments: CompanionFixture.Moment.allCases)
    func theTeamIsTheWebs(moment: CompanionFixture.Moment) throws {
        let all = CompanionFixture.Moment.allCases
        let read = Array(all.prefix(through: all.firstIndex(of: moment) ?? 0))
        var picks: [CompanionPick] = []
        var board: RoomBoardView?
        var latest: Companion?
        for step in read {
            let answer = try CompanionFixture.answer(step)
            if let raw = answer.board?.value1 {
                board = RoomBoardView(raw, teams: answer.teams)
            }
            picks = picks.filter { $0.pick <= answer.since } + answer.picks
            latest = answer
        }
        let model = try CompanionModel(
            companion: #require(latest), picks: picks, board: #require(board), seen: 0, filter: "All"
        )
        let web = try Self.web(moment)
        let team = try #require(web["team"] as? JSON)
        #expect(model.team.count == team["count"] as? String)
        let slots = team["slots"] as? [JSON] ?? []
        #expect(model.team.slots.map(\.slot) == slots.map { $0["slot"] as? String ?? "" })
        #expect(model.team.slots.map { $0.player?.id } == slots.map { $0["id"] as? String })
        #expect(model.team.slots.map(\.pick) == slots.map { $0["pick"] as? String })
        #expect(web["picks"] as? Int == picks.count)
    }
}

/// The report, the followed drafts and the sentences the replay never reaches.
@MainActor
extension CompanionParityTests {
    @Test func theReportIsTheWebs() async throws {
        let viewModel = await Self.viewModel(through: .complete)
        guard case let .report(report, bar) = viewModel.state else {
            Issue.record("the finished draft drew no report: \(viewModel.state)")
            return
        }
        let web = try #require(Self.parity["report"] as? JSON)
        #expect(bar.turn == "The draft is over")
        #expect(report.title == web["title"] as? String)
        #expect(report.points == web["points"] as? String)
        #expect(report.caption == web["caption"] as? String)
        let cells = web["cells"] as? [JSON] ?? []
        #expect(report.cells.map(\.label) == cells.map { $0["label"] as? String ?? "" })
        #expect(report.cells.map(\.value) == cells.map { $0["value"] as? String ?? "" })
        #expect(report.cells.map(\.mine) == cells.map { $0["mine"] as? Bool ?? false })
        #expect(Words.Companion.followAnother == web["verb"] as? String)
        #expect(report.basis == web["basis"] as? String)
        let field = try #require(web["field"] as? JSON)
        #expect(report.fieldNote == field["note"] as? String)
        let teams = field["rows"] as? [JSON] ?? []
        #expect(report.field.map(\.rank) == teams.map { $0["rank"] as? Int ?? 0 })
        #expect(report.field.map(\.name) == teams.map { $0["name"] as? String ?? "" })
        #expect(report.field.map(\.points) == teams.map { $0["points"] as? String ?? "" })
        #expect(report.field.map(\.you) == teams.map { $0["you"] as? Bool ?? false })
        for (ours, theirs) in zip(report.field, teams) {
            #expect(abs(ours.share - (theirs["share"] as? Double ?? 0)) < 1e-9)
        }
    }

    @Test func thePickByPickTableIsTheWebs() async throws {
        let viewModel = await Self.viewModel(through: .complete)
        guard case let .report(report, _) = viewModel.state else {
            Issue.record("no report")
            return
        }
        let picks = try #require((Self.parity["report"] as? JSON)?["picks"] as? JSON)
        #expect(report.picksNote == picks["note"] as? String)
        let rows = picks["rows"] as? [JSON] ?? []
        #expect(report.picks.map(\.pick) == rows.map { $0["pick"] as? String ?? "" })
        #expect(report.picks.map(\.name) == rows.map { $0["name"] as? String ?? "" })
        #expect(report.picks.map(\.slot) == rows.map { $0["slot"] as? String ?? "" })
        #expect(report.picks.map(\.figure) == rows.map { ($0["figure"] as? JSON)?["text"] as? String ?? "" })
        #expect(report.picks.map(\.figureMuted) == rows.map { ($0["figure"] as? JSON)?["muted"] as? Bool ?? false })
        #expect(report.picks.map { $0.adp?.text } == rows.map { ($0["adp"] as? JSON)?["text"] as? String })
        #expect(report.picks.map { $0.ours?.text } == rows.map { ($0["ours"] as? JSON)?["text"] as? String })
        #expect(report.picks.map { Self.tone($0.adp?.tone) } == rows.map { ($0["adp"] as? JSON)?["tone"] as? String })
        #expect(report.picks.map(\.still) == rows.map { ($0["still"] as? JSON)?["text"] as? String ?? "" })
        #expect(report.picks.map(\.stillWait) == rows.map { ($0["still"] as? JSON)?["wait"] as? Bool ?? false })
        #expect(report.picks.map(\.stillMuted) == rows.map { ($0["still"] as? JSON)?["muted"] as? Bool ?? false })
        #expect(report.picks.map(\.madeBy) == rows.map { $0["by"] as? String ?? "" })
    }

    static func tone(_ tone: GapTone?) -> String? {
        switch tone {
        case .gain?: "gain"
        case .loss?: "loss"
        case .even?: "even"
        case nil: nil
        }
    }

    @Test func theRunsAndWhoTheyLandAreTheWebs() async throws {
        let viewModel = await Self.viewModel(through: .complete)
        guard case let .report(report, _) = viewModel.state else {
            Issue.record("no report")
            return
        }
        let web = try #require(Self.parity["report"] as? JSON)
        let runs = try #require(web["runs"] as? JSON)
        #expect(report.runs.title == runs["title"] as? String)
        #expect(report.runs.note == runs["note"] as? String)
        #expect(report.runs.bins == runs["bins"] as? [Int])
        #expect(report.runs.medianBin == runs["medianBin"] as? Int)
        #expect(report.runs.low == runs["low"] as? String)
        #expect(report.runs.high == runs["high"] as? String)
        #expect(report.runs.median == runs["median"] as? String)
        #expect(report.runs.middle == runs["middle"] as? String)
        #expect(report.runs.topShare == runs["topShare"] as? String)
        #expect(report.runs.topWords == runs["topWords"] as? String)
        #expect(report.runs.ranks == runs["ranks"] as? [Int])
        #expect(report.runs.rank == runs["rank"] as? Int)
        let exposure = try #require(web["exposure"] as? JSON)
        #expect(report.exposureTitle == exposure["title"] as? String)
        #expect(report.exposureAside == exposure["aside"] as? String)
        let rows = exposure["rows"] as? [JSON] ?? []
        #expect(report.exposure.map(\.player.id) == rows.map { $0["id"] as? String ?? "" })
        #expect(report.exposure.map(\.player.pill) == rows.map { $0["pill"] as? String ?? "" })
        #expect(report.exposure.map(\.percent) == rows.map { $0["percent"] as? String ?? "" })
    }

    @Test func theFollowedDraftsReadAsTheWebsLines() throws {
        let web = try #require(Self.parity["recent"] as? [JSON])
        let ours = try CompanionFixture.recent().map(CompanionWords.recentLine)
        #expect(ours.map(\.lead) == web.map { $0["lead"] as? String ?? "" })
        #expect(ours.map(\.text) == web.map { $0["text"] as? String ?? "" })
    }

    @Test func theSentencesTheReplayNeverReachesAreTheWebs() throws {
        let web = try #require(Self.parity["edges"] as? JSON)
        let between = try CompanionFixture.answer(.between)
        func edited(_ change: (inout Companion) -> Void) -> Companion {
            var copy = between
            change(&copy)
            return copy
        }
        #expect(CompanionWords.turn(edited { $0.status = .init(value1: .preDraft) }) == web["preDraft"] as? String)
        #expect(CompanionWords.turn(edited { $0.status = .init(value1: .paused) }) == web["paused"] as? String)
        #expect(CompanionWords.turn(edited {
            $0.status = .init(value1: .paused)
            $0.yourTurn = true
        }) == web["pausedOnTurn"] as? String)
        #expect(CompanionWords.turn(edited {
            $0.yourNextPick = nil
            $0.picksUntilTurn = nil
        }) == web["lastPicksIn"] as? String)
        #expect(CompanionWords.turn(edited { $0.status = .init(value1: .complete) }) == web["over"] as? String)
        #expect(CompanionWords.stale(edited { $0.hostStaleSeconds = 14 }) == web["stale"] as? String)
        #expect(CompanionWords.lost(edited { $0.lostAt = 37 }) == web["lost"] as? String)
        #expect(CompanionWords.draftName("") == web["unnamed"] as? String)
        let named: [Components.Schemas.NamedPick] = [
            .init(hostName: "Kenneth Walker", boardName: "Kenneth Walker III"),
            .init(hostName: "Marvin Harrison", boardName: "Marvin Harrison Jr."),
            .init(hostName: "DJ Moore", boardName: "D.J. Moore"),
            .init(hostName: "Hollywood Brown", boardName: "Marquise Brown"),
        ]
        #expect(CompanionWords.notes(edited {
            $0.unplaced = 1
            $0.traded = 1
        }, named: Array(named.prefix(1))) == web["notesOne"] as? [String])
        #expect(CompanionWords.notes(edited {
            $0.unplaced = 3
            $0.traded = 2
        }, named: named) == web["notesMany"] as? [String])
        var last = try #require(between.card?.value1)
        last.conditional = false
        last.nextPick = nil
        #expect(CompanionWords.chanceLabel(last, teams: between.teams) == web["chanceLast"] as? String)
        #expect(CompanionWords.draftURL(.init(value1: .ffpc), draftID: between.hostDraftId)?.absoluteString
            == web["ffpcURL"] as? String)
        #expect(CompanionWords.turn(edited { $0.host = .init(value1: .ffpc) }) == web["ffpcTurn"] as? String)
        let missing = try #require(web["missing"] as? JSON)
        #expect(RoomWords.chanceMissing(gone: true, read: false) == missing["gone"] as? String)
        #expect(RoomWords.chanceMissing(gone: false, read: false) == missing["coming"] as? String)
        let empty = try #require(web["empty"] as? JSON)
        #expect(RoomWords.poolEmpty(filter: "K") == empty["left"] as? String)
    }
}
