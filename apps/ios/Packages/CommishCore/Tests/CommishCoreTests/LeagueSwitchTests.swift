import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The league switch names each league and its phase exactly as the web's menu does
/// (shared/fixtures/parity/shell.json, written from web/src/lib/context/menu-words.ts phaseWords and
/// league/names.ts followedName) with the web's line under it (leagueLine), lists every followed league
/// in GET /me's order with the selected one marked in place, and says what to do with none.
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

    struct Line: Decodable {
        let host: String
        let scoring: String
        let format: String
        let line: String
    }

    struct Shell: Decodable {
        let zone: String
        let cases: [Case]
        let lines: [Line]
        let sheetLoading: String
    }

    static func shell() throws -> Shell {
        try JSONDecoder().decode(Shell.self, from: Fixtures.data("fixtures/parity/shell.json"))
    }

    static func host(_ word: String) throws -> Components.Schemas.LeagueHost {
        try JSONDecoder().decode(Components.Schemas.LeagueHost.self, from: Data("\"\(word)\"".utf8))
    }

    static func followed(_ league: WebLeague) throws -> FollowedLeague {
        try FollowedLeague(
            id: league.id, name: league.name, host: host(league.host), scoring: .ppr, format: .ppr,
            phase: Components.Schemas.LeaguePhaseKnown(rawValue: league.phase),
            draftAt: league.draft_at.flatMap(APIDecoding.parseDate), waiversOpen: true
        )
    }

    @Test func everyPlatformScoringAndBoardLineIsTheWebs() throws {
        let lines = try Self.shell().lines
        #expect(lines.count == 40)
        for item in lines {
            let league = try FollowedLeague(
                id: "l", name: "L", host: Self.host(item.host),
                scoring: Components.Schemas.ScoringPresetKnown(rawValue: item.scoring),
                format: Components.Schemas.BoardFormatKnown(rawValue: item.format), phase: .inSeason, draftAt: nil,
                waiversOpen: true
            )
            #expect(LeagueNames.leagueLine(league) == item.line, "\(item.host) \(item.scoring) \(item.format)")
        }
    }

    /// A scoring this build does not know: the platform alone, never a code.
    @Test func aScoringThisBuildDoesNotKnowLeavesThePlatform() throws {
        let league = try FollowedLeague(
            id: "l", name: "L", host: Self.host("espn"), scoring: nil, format: nil, phase: .inSeason, draftAt: nil,
            waiversOpen: true
        )
        #expect(LeagueNames.leagueLine(league) == "ESPN")
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

    @Test func theListKeepsTheAPIsOrderAndMarksTheSelectedLeagueInPlace() throws {
        let leagues = try Self.three()
        let pick = leagues[1].id
        let model = LeagueSwitchModel(
            leagues: leagues, selected: pick, now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone
        )
        #expect(model.face == "Thursday Night Keepers")
        #expect(model.title == Words.Shell.yourLeagues)
        #expect(model.rows.map(\.id) == leagues.map(\.id))
        #expect(model.rows.map(\.selected) == [false, true, false])
        #expect(model.rows.map(\.line) == ["FFPC, PPR", "Sleeper, PPR", "Sleeper, PPR"])
        #expect(model.rows.map(\.phase) == ["Drafted", "Draft Wed 12:00 pm", "Playoffs"])
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

    /// The site's links the app takes: the sign-in return and a player's page; anything else is left.
    @Test func theAppRoutesItsOwnLinks() throws {
        let link = { (text: String) in try AppLink.of(#require(URL(string: text))) }
        #expect(try link("https://trycommish.app/app/signed-in?code=c&client=ios") == .signIn)
        #expect(try link("https://trycommish.app/players/puka-nacua") == .player(slug: "puka-nacua"))
        #expect(try link(SiteLinks.player("puka-nacua").absoluteString) == .player(slug: "puka-nacua"))
        #expect(try link("https://trycommish.app/players/") == nil)
        #expect(try link("https://trycommish.app/league/l-1") == nil)
        #expect(try link("https://example.com/players/puka-nacua") == nil)
    }

    @Test func theSearchOpensPlayersWithWhatWasTyped() {
        #expect(ShellRoute.search("  Puka ") == .players(query: "Puka"))
        #expect(ShellRoute.search("   ") == nil)
    }

    /// A score bug opens its game (Lane 206): the member's on the Matchup tab where the bar has one,
    /// every other team's pushed by its roster on the tab in view.
    @Test func aScoreBugOpensItsGame() {
        let season = PhoneRail.tabs(phase: .inSeason, waiversOpen: true)
        let preDraft = PhoneRail.tabs(phase: .preDraft, waiversOpen: true)
        #expect(season.contains { $0.key == PhoneRail.matchupKey })
        #expect(ShellRoute.game(of: nil, league: "l-1", in: season) == .tab(PhoneRail.matchupKey))
        #expect(ShellRoute.game(of: 2, league: "l-1", in: season) == .push(.game(league: "l-1", roster: 2)))
        #expect(!preDraft.contains { $0.key == PhoneRail.matchupKey })
        #expect(ShellRoute.game(of: nil, league: "l-1", in: preDraft) == .push(.game(league: "l-1", roster: nil)))
    }

    /// Signed out, a site link to a page the web serves to anyone opens (a player, the reference pages,
    /// a mock's setup, a shared mock); the account, a league's screens and the companion wait for the
    /// sign-in (Lane 221 review M1).
    @Test(arguments: [
        (ShellRoute.players(query: "puka"), true),
        (.player(slug: "puka-nacua"), true),
        (.adp(format: "ppr-12"), true),
        (.compare(first: "a", second: "b"), true),
        (.clubs, true),
        (.club(abbr: "LAR"), true),
        (.schedule, true),
        (.mockSetup(from: nil), true),
        (.sharedMock(code: "abc"), true),
        (.account, false),
        (.leagueHome(id: "l-1"), false),
        (.game(league: "l-1", roster: 2), false),
        (.companionNew(replay: false), false),
        (.companion(id: "d-1"), false),
    ])
    func aRouteOpensSignedOutOnlyWherePublic(route: ShellRoute, open: Bool) {
        #expect(route.isPublic == open)
    }
}
