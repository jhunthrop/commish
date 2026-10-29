import CommishAPI
import CommishDesign
import Foundation

/// A followed league's row as the web's Leagues attached table draws it on a phone.
public struct AccountLeagueRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    /// "McConkey Kong Country, on Sleeper".
    public let team: String
    /// "1-4", "--" before a read.
    public let record: String
    /// "12th of 12", empty before a read.
    public let place: String
    public let season: String
    /// "4 minutes ago", "Oct 12", "--".
    public let read: String
    /// Detached a moment ago: its undo shows in place of its verbs.
    public let detached: Bool

    /// The phone's line under the row (AccountLeagues.svelte .ph-only): "Last read 4 minutes ago".
    public var readLine: String {
        "\(Words.Attached.lastRead) \(read)"
    }
}

/// A paired device's row: its name, "Paired Oct 12, last used Oct 17", and whether it is this phone.
public struct AccountDeviceRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let line: String
    public let thisPhone: Bool
}

/// The plan card as the web prints it in the free season (account/words.ts FREE_SEASON_PLAN, FREE_SEE).
/// The app never draws a price or a paywall: outside the free season, or for a plan bought on the web,
/// there is no card here and the plan is the web's to show.
public struct PlanCard: Equatable, Sendable {
    public let title: String
    public let line: String
    public let see: String

    static let free = PlanCard(title: Words.FreePlan.title, line: Words.FreePlan.line, see: Words.FreePlan.see)

    /// pass/free-season.ts FREE_SEASON_ENDS, generated (Words.FreeSeason): the API's season.End(2026).
    static let freeSeasonEnds = APIDecoding.parseDate(Words.FreeSeason.ends)!

    /// free-season.ts freeSeasonAt: the API's `free_season` whenever it answers one, true or false;
    /// only without it (an older API, a failed read) the clock rule, free until the season's end.
    public static func freeSeason(at now: Date, flag: Bool?) -> Bool {
        flag ?? (now < freeSeasonEnds)
    }

    /// The card for this account at this instant: the free season's, unless the account bought a plan
    /// (words.ts boughtPlan), which keeps its own card on the web.
    public static func of(_ account: AccountAnswer, now: Date, flag: Bool?) -> PlanCard? {
        guard freeSeason(at: now, flag: flag), !bought(account) else {
            return nil
        }
        return free
    }

    static func bought(_ account: AccountAnswer) -> Bool {
        account.membership?.value1.source.value1 == .subscription
            || account.draftPass?.value1.source.value1 == .purchase
    }
}

/// What the Account screen reads, kept on the phone for no signal: the account, the leagues followed
/// (nil when they could not be read), the paired devices and the API's free-season flag (nil when the
/// API sent none or the read failed).
public struct AccountScreenAnswer: Codable, Equatable, Sendable {
    public let me: AccountAnswer
    public let leagues: [AttachedLeague]?
    public let devices: [PairedDeviceRow]
    public let freeSeason: Bool?

    public init(me: AccountAnswer, leagues: [AttachedLeague]?, devices: [PairedDeviceRow], freeSeason: Bool?) {
        self.me = me
        self.leagues = leagues
        self.devices = devices
        self.freeSeason = freeSeason
    }

    func without(device id: String) -> AccountScreenAnswer {
        AccountScreenAnswer(
            me: me, leagues: leagues, devices: devices.filter { $0.id != id }, freeSeason: freeSeason
        )
    }

    func with(me: AccountAnswer) -> AccountScreenAnswer {
        AccountScreenAnswer(me: me, leagues: leagues, devices: devices, freeSeason: freeSeason)
    }

    func without(league id: String) -> AccountScreenAnswer {
        AccountScreenAnswer(
            me: me, leagues: leagues?.filter { $0.id != id }, devices: devices, freeSeason: freeSeason
        )
    }
}

/// The Account screen as the web's account page draws it on a phone: who, the leagues followed, the
/// plan, the paired devices with this phone marked. The push switches are the view model's.
public struct AccountModel: Equatable, Sendable {
    public let name: String
    /// "fixture@example.com, with us since Sep 1".
    public let line: String
    /// Nil when the leagues could not be read: the web's sentence says so.
    public let leagues: [AccountLeagueRow]?
    public let leaguesAside: String?
    public let devices: [AccountDeviceRow]
    public let devicesAside: String
    public let plan: PlanCard?
    /// The account may follow another league (many_leagues): the web's Follow another league.
    public let followMore: Bool

    public init(
        answer: AccountScreenAnswer, detached: Set<String>, thisDevice: String?, now: Date, zone: TimeZone
    ) {
        name = AccountWords.displayName(answer.me)
        line = AccountWords.whoLine(answer.me)
        leagues = answer.leagues?.map {
            AccountWords.leagueRow($0, now: now, zone: zone, detached: detached.contains($0.id))
        }
        leaguesAside = answer.leagues.map { AccountWords.attachedCount($0.count) }
        devices = answer.devices.map {
            AccountDeviceRow(
                id: $0.id, name: $0.name, line: AccountWords.deviceLine($0), thisPhone: $0.id == thisDevice
            )
        }
        devicesAside = AccountWords.deviceCount(answer.devices.count)
        plan = PlanCard.of(answer.me, now: now, flag: answer.freeSeason)
        followMore = answer.me.features.contains { $0.value1 == .manyLeagues }
    }
}
