package app.trycommish.core.companion

import app.trycommish.api.models.CompanionHost
import app.trycommish.api.models.CompanionStatus
import app.trycommish.api.models.CompanionSummary
import app.trycommish.api.models.DraftCompanion
import app.trycommish.api.models.NamedPick
import app.trycommish.api.models.RoomCard
import app.trycommish.core.AppWords
import app.trycommish.core.Format
import app.trycommish.core.account.AccountWords
import app.trycommish.core.instantOrNull
import app.trycommish.design.Words

/** A followed draft as the start page lists it (model.ts recentLine): its name, then the seat, the status
 * and the day it was followed. */
data class RecentLine(
    val lead: String,
    val text: String,
)

/**
 * The live-draft companion's sentences that name the platform or a pick (web/src/lib/companion/model.ts),
 * the iOS CompanionWords' and held to shared/fixtures/parity/companion.json; the plain words are the
 * generated Words.Companion and Words.CompanionNew.
 */
object CompanionWords {
    /** model.ts NAMED_LINES: the name-matched picks named at most. */
    private const val NAMED_LINES = 2

    /** The platform as a sentence names it: "Sleeper", "FFPC" (model.ts hostName). */
    fun platform(host: CompanionHost): String =
        when (host) {
            CompanionHost.sleeper -> Words.Platform.sleeper
            CompanionHost.ffpc -> Words.Platform.ffpc
            CompanionHost.unknown_default_open_api -> AppWords.unknownPlatform
        }

    /** model.ts turnWords: the bar's line under the count, where the draft is and when you are up. */
    fun turn(draft: DraftCompanion): String {
        val on = platform(draft.host)
        when (draft.status) {
            CompanionStatus.pre_draft -> return "Waiting for the draft to start on $on"
            CompanionStatus.complete -> return "The draft is over"
            CompanionStatus.drafting, CompanionStatus.paused, CompanionStatus.unknown_default_open_api -> Unit
        }
        val paused = if (draft.status == CompanionStatus.paused) "Paused on $on. " else ""
        if (draft.yourTurn) return "${paused}You're on the clock on $on"
        val next = draft.yourNextPick
        val away = draft.picksUntilTurn
        if (next == null || away == null) return "${paused}Your picks are in"
        return "${paused}You pick at ${DraftFormat.pickLabel(next, draft.teams)}, ${Format.plural(away, "pick", "picks")} away"
    }

    /** model.ts seatNames: each seat's name, slot 1 first: You, the member's name on the platform, or
     * "Slot 4" for a slot no member holds. */
    fun seatNames(draft: DraftCompanion): List<String> =
        (1..maxOf(1, draft.teams)).map { seat ->
            if (seat == draft.slot) return@map "You"
            draft.seatNames.getOrNull(seat - 1)?.takeIf { it.isNotEmpty() } ?: "Slot $seat"
        }

    /** model.ts pickCount: "22 of 240". */
    fun pickCount(draft: DraftCompanion): String = "${draft.pickCount} of ${draft.totalPicks}"

    /** model.ts picksMadeWords: "picks made on Sleeper". */
    fun picksMade(host: CompanionHost): String = "picks made on ${platform(host)}"

    /** model.ts draftOnWords: "The draft on Sleeper". */
    fun draftOn(host: CompanionHost): String = "The draft on ${platform(host)}"

    /** model.ts openDraftWords: "Open the draft on Sleeper". */
    fun openDraft(host: CompanionHost): String = "Open the draft on ${platform(host)}"

    /** model.ts draftName: the platform's name for the draft, else "Your draft". */
    fun draftName(name: String): String = name.ifEmpty { Words.Companion.yourDraft }

    /** model.ts staleWords: the bar's line when the platform did not answer the last read. */
    fun stale(draft: DraftCompanion): String? =
        draft.hostStaleSeconds?.let { "${platform(draft.host)} has not answered for $it seconds. These are its last picks." }

    /** model.ts makePickWords: the one verb at the drafter's turn. */
    fun makePick(host: CompanionHost): String = "Make the pick on ${platform(host)}"

    /** model.ts queueWords: the verb between turns. */
    fun queue(host: CompanionHost): String = "Queue him on ${platform(host)}"

    /** model.ts justTakenWords: "just taken on Sleeper". */
    fun justTaken(host: CompanionHost): String = "just taken on ${platform(host)}"

    /** model.ts leagueOnWords: the report's Other seats, "Your league on Sleeper". */
    fun leagueOn(host: CompanionHost): String = "Your league on ${platform(host)}"

    /** model.ts chanceLabel: what a chance is of, "reaches 2.08", "still there at 3.05", "your last pick". */
    fun chanceLabel(
        card: RoomCard?,
        teams: Int,
    ): String {
        if (card != null && card.conditional) return "reaches ${DraftFormat.pickLabel(card.forPick, teams)}"
        return card?.nextPick?.let { "still there at ${DraftFormat.pickLabel(it, teams)}" } ?: "your last pick"
    }

    /** model.ts chanceColumn: the pool's chance column. */
    fun chanceColumn(card: RoomCard?): String =
        if (card?.conditional ==
            true
        ) {
            Words.Companion.reachesHead
        } else {
            Words.Companion.stillThereHead
        }

    /** model.ts lostWords: the line once our draft stops following the platform's. */
    fun lost(draft: DraftCompanion): String? =
        draft.lostAt?.let {
            "Pick ${DraftFormat.pickLabel(it, draft.teams)} on ${platform(draft.host)} does not fit how our draft is set up, " +
                "so our call stops there. The picks keep landing below."
        }

    /** model.ts companionNotes: picks we do not rank, the name-matched picks not told yet, traded picks. */
    fun notes(
        draft: DraftCompanion,
        named: List<NamedPick>,
    ): List<String> {
        val on = platform(draft.host)
        val unplaced =
            draft.unplaced.takeIf { it > 0 }?.let {
                val are = if (it == 1) "is a player" else "are players"
                "${Format.plural(
                    it,
                    "pick",
                    "picks",
                )} on $on $are we do not rank. Each fills his team's roster and takes nobody from our board."
            }
        // A name that ends in "Jr." ends the sentence too.
        val told =
            named
                .take(
                    NAMED_LINES,
                ).map { "${it.hostName} on $on is our ${it.boardName}${if (it.boardName.endsWith(".")) "" else "."}" }
        val more = (named.size - NAMED_LINES).takeIf { it > 0 }?.let { "And $it more placed by name." }
        val traded =
            draft.traded.takeIf { it > 0 }?.let {
                "${Format.plural(it, "pick", "picks")} changed hands on $on. Our call follows the draft order by slot."
            }
        return listOfNotNull(unplaced) + told + listOfNotNull(more, traded)
    }

    /** model.ts hostDraftUrl: the platform's own page for the draft, where the pick is made. FFPC's board is
     * keyed by the member's own team, which only its My Teams page opens. */
    fun draftUrl(
        host: CompanionHost,
        draftId: String,
    ): String = if (host == CompanionHost.ffpc) "https://myffpc.com/MyTeams.aspx" else "https://sleeper.com/draft/nfl/$draftId"

    /** model.ts STATUS_WORDS: a followed draft's status on the start page. */
    private fun summaryStatus(status: CompanionStatus): String =
        when (status) {
            CompanionStatus.pre_draft -> "not started"
            CompanionStatus.drafting -> "drafting"
            CompanionStatus.paused -> "paused"
            CompanionStatus.complete -> "over, the report is ready"
            CompanionStatus.unknown_default_open_api -> status.value
        }

    /** model.ts recentLine: a followed draft as the start page lists it, its name, then the seat, the
     * status and the day it was followed (on the site's clock, format/date.ts dayLabel). */
    fun recentLine(summary: CompanionSummary): RecentLine {
        val seat = summary.hostUsername?.let { "@$it, slot ${summary.slot}" } ?: "slot ${summary.slot}"
        val lead = summary.name.ifEmpty { "${platform(summary.host)} draft ${summary.hostDraftId}" }
        val day = instantOrNull(summary.createdAt)?.let(AccountWords::dayLabel).orEmpty()
        return RecentLine(lead, "$seat · ${summaryStatus(summary.status)} · followed $day")
    }
}
