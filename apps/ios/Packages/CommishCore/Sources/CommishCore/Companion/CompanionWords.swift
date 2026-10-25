import CommishAPI
import CommishDesign
import Foundation

/// The live-draft companion's sentences that name the platform or a pick (web/src/lib/companion/model.ts),
/// ported and held to shared/fixtures/parity/companion.json; the plain words are the generated
/// `Words.Companion` and `Words.CompanionNew`.
public enum CompanionWords {
    /// The platform as a sentence names it: "Sleeper", "FFPC" (model.ts hostName), its raw id for one
    /// this app does not know yet.
    public static func host(_ host: Components.Schemas.CompanionHost) -> String {
        switch host.value1 {
        case .sleeper: "Sleeper"
        case .ffpc: "FFPC"
        case nil: host.value2 ?? ""
        }
    }

    /// The draft's status as the API names it: "pre_draft", "drafting", "paused", "complete".
    public static func status(_ status: Components.Schemas.CompanionStatus) -> String {
        status.value1?.rawValue ?? status.value2 ?? ""
    }

    /// model.ts turnWords: the bar's line under the count, where the draft is and when you are up.
    public static func turn(_ companion: Companion) -> String {
        let host = host(companion.host)
        switch status(companion.status) {
        case "pre_draft":
            return "Waiting for the draft to start on \(host)"
        case "complete":
            return "The draft is over"
        default:
            break
        }
        let paused = status(companion.status) == "paused" ? "Paused on \(host). " : ""
        if companion.yourTurn {
            return "\(paused)You're on the clock on \(host)"
        }
        guard let next = companion.yourNextPick, let away = companion.picksUntilTurn else {
            return "\(paused)Your picks are in"
        }
        let pick = DraftFormat.pickLabel(next, teams: companion.teams)
        return "\(paused)You pick at \(pick), \(Formatting.plural(away, "pick")) away"
    }

    /// model.ts seatNames: each seat's name, slot 1 first: You, the member's name on the platform, or
    /// "Slot 4" for a slot no member holds.
    public static func seatNames(_ companion: Companion) -> [String] {
        (1 ... max(1, companion.teams)).map { seat in
            if seat == companion.slot {
                return "You"
            }
            let name = seat - 1 < companion.seatNames.count ? companion.seatNames[seat - 1] : ""
            return name.isEmpty ? "Slot \(seat)" : name
        }
    }

    /// model.ts pickCount: "22 of 240".
    public static func pickCount(_ companion: Companion) -> String {
        "\(companion.pickCount) of \(companion.totalPicks)"
    }

    /// model.ts picksMadeWords: "picks made on Sleeper".
    public static func picksMade(_ host: Components.Schemas.CompanionHost) -> String {
        "picks made on \(Self.host(host))"
    }

    /// model.ts draftOnWords: "The draft on Sleeper".
    public static func draftOn(_ host: Components.Schemas.CompanionHost) -> String {
        "The draft on \(Self.host(host))"
    }

    /// model.ts openDraftWords: "Open the draft on Sleeper".
    public static func openDraft(_ host: Components.Schemas.CompanionHost) -> String {
        "Open the draft on \(Self.host(host))"
    }

    /// model.ts draftName: the platform's name for the draft, else "Your draft".
    public static func draftName(_ name: String) -> String {
        name.isEmpty ? Words.Companion.yourDraft : name
    }

    /// model.ts staleWords: the bar's line when the platform did not answer the last read.
    public static func stale(_ companion: Companion) -> String? {
        companion.hostStaleSeconds.map {
            "\(host(companion.host)) has not answered for \($0) seconds. These are its last picks."
        }
    }

    /// model.ts makePickWords: the one verb at the drafter's turn.
    public static func makePick(_ host: Components.Schemas.CompanionHost) -> String {
        "Make the pick on \(Self.host(host))"
    }

    /// model.ts queueWords: the verb between turns.
    public static func queue(_ host: Components.Schemas.CompanionHost) -> String {
        "Queue him on \(Self.host(host))"
    }

    /// model.ts justTakenWords: "just taken on Sleeper".
    public static func justTaken(_ host: Components.Schemas.CompanionHost) -> String {
        "just taken on \(Self.host(host))"
    }

    /// model.ts leagueOnWords: the report's Other seats, "Your league on Sleeper".
    public static func leagueOn(_ host: Components.Schemas.CompanionHost) -> String {
        "Your league on \(Self.host(host))"
    }

    /// model.ts chanceLabel: what a chance is of, "reaches 2.08", "still there at 3.05", "your last pick".
    public static func chanceLabel(_ card: RoomCard?, teams: Int) -> String {
        if let card, card.conditional {
            return "reaches \(DraftFormat.pickLabel(card.forPick, teams: teams))"
        }
        if let next = card?.nextPick {
            return "still there at \(DraftFormat.pickLabel(next, teams: teams))"
        }
        return "your last pick"
    }

    /// model.ts chanceColumn: the pool's chance column.
    public static func chanceColumn(_ card: RoomCard?) -> String {
        card?.conditional == true ? Words.Companion.reachesHead : Words.Companion.stillThereHead
    }

    /// model.ts lostWords: the line once our draft stops following the platform's.
    public static func lost(_ companion: Companion) -> String? {
        companion.lostAt.map {
            "Pick \(DraftFormat.pickLabel($0, teams: companion.teams)) on \(host(companion.host)) does not fit how "
                + "our draft is set up, so our call stops there. The picks keep landing below."
        }
    }

    /// model.ts NAMED_LINES: the name-matched picks named at most.
    static let namedLines = 2

    /// model.ts companionNotes: picks we do not rank, the name-matched picks not told yet, traded picks.
    public static func notes(_ companion: Companion, named: [Components.Schemas.NamedPick]) -> [String] {
        let host = host(companion.host)
        var notes: [String] = []
        if companion.unplaced > 0 {
            let are = companion.unplaced == 1 ? "is a player" : "are players"
            notes.append(
                "\(Formatting.plural(companion.unplaced, "pick")) on \(host) \(are) we do not rank. "
                    + "Each fills his team's roster and takes nobody from our board."
            )
        }
        notes += named.prefix(namedLines).map { pick in
            // A name that ends in "Jr." ends the sentence too.
            "\(pick.hostName) on \(host) is our \(pick.boardName)\(pick.boardName.hasSuffix(".") ? "" : ".")"
        }
        if named.count > namedLines {
            notes.append("And \(named.count - namedLines) more placed by name.")
        }
        if companion.traded > 0 {
            notes.append(
                "\(Formatting.plural(companion.traded, "pick")) changed hands on \(host). "
                    + "Our call follows the draft order by slot."
            )
        }
        return notes
    }

    /// model.ts hostDraftUrl: the platform's own page for the draft, where the pick is made. FFPC's
    /// board is keyed by the member's own team, which only its My Teams page opens.
    public static func draftURL(_ host: Components.Schemas.CompanionHost, draftID: String) -> URL? {
        if host.value1 == .ffpc {
            return URL(string: "https://myffpc.com/MyTeams.aspx")
        }
        return URL(string: "https://sleeper.com/draft/nfl/\(draftID)")
    }

    /// model.ts STATUS_WORDS: a followed draft's status on the start page.
    static func summaryStatus(_ status: String) -> String {
        switch status {
        case "pre_draft": "not started"
        case "drafting": "drafting"
        case "paused": "paused"
        case "complete": "over, the report is ready"
        default: status
        }
    }

    /// model.ts recentLine: a followed draft as the start page lists it, its name, then the seat, the
    /// status and the day it was followed (on the site's clock, format/date.ts dayLabel).
    public static func recentLine(_ summary: CompanionSummary) -> (lead: String, text: String) {
        let seat = summary.hostUsername.map { "@\($0), slot \(summary.slot)" } ?? "slot \(summary.slot)"
        let lead = summary.name.isEmpty ? "\(host(summary.host)) draft \(summary.hostDraftId)" : summary.name
        let status = summaryStatus(summary.status.value1?.rawValue ?? summary.status.value2 ?? "")
        let day = Formatting.shortDay(summary.createdAt, zone: AccountWords.siteZone)
        return (lead, "\(seat) · \(status) · followed \(day)")
    }
}
