import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The league switch names each league and its phase exactly as the web's menu does
/// (shared/fixtures/parity/shell.json, written from web/src/lib/context/menu-words.ts phaseWords and
/// league/names.ts followedName), lists every followed league with the selected one first, and says
/// what to do with none.
struct LeagueSwitchTests {
    struct WebLeague: Decodable {
        let id: String
        let name: String
        let host: String
        let phase: String
        // swiftlint:disable:next identifier_name
        let draft_at: String?
    }

    struct Case: Decodable {
        let set: String
        let now: String
        let leagues: [WebLeague]
        let names: [String: String]
        let phases: [String: String]
    }

    struct Shell: Decodable {
        let zone: String
        let cases: [Case]
        let sheetLoading: String
    }

    static func shell() throws -> Shell {
        try JSONDecoder().decode(Shell.self, from: Fixtures.data("fixtures/parity/shell.json"))
    }

    static func followed(_ league: WebLeague) throws -> FollowedLeague {
        let host = try JSONDecoder().decode(Components.Schemas.LeagueHost.self, from: Data("\"\(league.host)\"".utf8))
        return FollowedLeague(
            id: league.id, name: league.name, host: host,
            phase: Components.Schemas.LeaguePhaseKnown(rawValue: league.phase),
            draftAt: league.draft_at.flatMap(APIDecoding.parseDate), waiversOpen: true
        )
    }

    @Test func everyCasesNamesAndPhaseWordsAreTheWebs() throws {
        let shell = try Self.shell()
        let zone = try #require(TimeZone(identifier: shell.zone))
        #expect(shell.cases.count == 12)
        for item in shell.cases {
            let leagues = try item.leagues.map(Self.followed)
            let now = try #require(APIDecoding.parseDate(item.now))
            #expect(PhaseWords.phaseWords(leagues, now: now, zone: zone) == item.phases, "\(item.set) \(item.now)")
            for league in leagues {
                #expect(LeagueNames.followedName(league) == item.names[league.id], "\(league.id)")
            }
        }
    }

    static func three() throws -> [FollowedLeague] {
        let account = try #require(try Self.shell().cases.first { $0.set == "account" })
        return try account.leagues.filter { ["026", "040", "042"].contains(String($0.id.suffix(3))) }
            .map(Self.followed)
    }

    @Test func theSelectedLeagueLeadsTheListAndNamesTheSwitch() throws {
        let leagues = try Self.three()
        let pick = leagues[1].id
        let model = LeagueSwitchModel(
            leagues: leagues, selected: pick, now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone
        )
        #expect(model.face == "Thursday Night Keepers")
        #expect(model.title == Words.Shell.yourLeagues)
        #expect(model.rows.map(\.id) == [leagues[1].id, leagues[0].id, leagues[2].id])
        #expect(model.rows.map(\.selected) == [true, false, false])
        #expect(model.rows.map(\.line) == ["Sleeper", "FFPC", "Sleeper"])
        #expect(model.rows.map(\.phase) == ["Draft Wed 12:00 pm", "Drafted", "Playoffs"])
        #expect(model.none == nil)
    }

    @Test func leaguesInOnePhaseCarryNoPhaseWord() throws {
        let leagues = try Self.three().filter { $0.phase == .inSeason }
        let model = LeagueSwitchModel(
            leagues: leagues, selected: leagues.first?.id, now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone
        )
        #expect(model.rows.allSatisfy { $0.phase == nil })
    }

    @Test func noLeagueFollowedSaysHowToFollowOne() {
        let model = LeagueSwitchModel(
            leagues: [],
            selected: nil,
            now: Fixtures.instant(Fixtures.week),
            zone: Fixtures.zone
        )
        #expect(model.face == Words.LeagueSwitch.followFirst)
        #expect(model.rows.isEmpty)
        #expect(model.none == AppWords.LeagueList.none)
    }

    @Test func aPhaseThisBuildDoesNotKnowReadsAsDrafted() {
        #expect(PhaseWords.phaseWord(nil, draftAt: nil, now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone)
            == PhaseWords.phaseWord(.inSeason, draftAt: nil, now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone))
    }

    /// B149: a bar with no League tab (before the draft) still reaches the League home, through the
    /// switch; a bar with one opens it there.
    @Test func choosingALeagueOpensItsHome() {
        let preDraft = PhoneRail.tabs(phase: .preDraft, waiversOpen: true)
        #expect(ShellRoute.home(of: "l-1", in: preDraft) == .push(.leagueHome(id: "l-1")))
        let season = PhoneRail.tabs(phase: .inSeason, waiversOpen: true)
        #expect(ShellRoute.home(of: "l-1", in: season) == .tab(PhoneRail.leagueKey))
    }

    @Test func theSearchOpensPlayersWithWhatWasTyped() {
        #expect(ShellRoute.search("  Puka ") == .players(query: "Puka"))
        #expect(ShellRoute.search("   ") == nil)
    }
}
