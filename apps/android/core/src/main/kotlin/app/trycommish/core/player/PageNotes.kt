package app.trycommish.core.player

import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.RunClub
import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunLastGameClub
import app.trycommish.api.models.RunPlayerStatus
import app.trycommish.api.models.ScoringPreset
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.start.BasisParts
import app.trycommish.core.start.RowStatuses
import app.trycommish.design.Words
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/**
 * The notes the player page draws under its card (B165, the web's /players/[slug] after PlayerCard): the
 * club line when his newest game was for another club (server/pages/player.ts clubNoteOf over
 * player/club-words.ts), the status note for a player the injury capture lists (run/status-view.ts
 * playerStatusWords' note), and the league line about the figures' scoring against the selected league's
 * (context/note-words.ts contextNote, "These figures are"). Held to shared/fixtures/parity/player-sheet.json.
 */
object PageNotes {
    /** designation.ts CAPTURE_BEHIND_MS: past this long since the check, the note says how old it is. */
    private val CAPTURE_BEHIND: Duration = Duration.ofHours(36)

    /** clubNoteOf: "Now with the Dolphins. His week 5 game was for the Chargers.", a free agent's "Now a free
     * agent. ...", a special-teams week "... His week 4 snaps were on special teams for the Eagles."; null
     * with no newer game for another club, or a club the run does not name. */
    fun club(
        team: String,
        last: RunLastGameClub?,
        clubs: List<RunClub>,
    ): String? {
        last ?: return null
        val lineClub = clubs.firstOrNull { it.abbr == last.club } ?: return null
        val now =
            if (team == Words.Figure.freeAgentClub) {
                "Now ${Words.Figure.freeAgent}."
            } else {
                "Now with the ${clubs.firstOrNull { it.abbr == team }?.nickname ?: return null}."
            }
        val week =
            if (last.specialTeams == true) {
                "His week ${last.week} snaps were on special teams for the ${lineClub.nickname}."
            } else {
                "His week ${last.week} game was for the ${lineClub.nickname}."
            }
        return "$now $week"
    }

    /** playerStatusWords' note: a season-long list's sentence or the week's designation, then the capture
     * it is from, on the member's clock. */
    fun status(
        status: RunPlayerStatus,
        capture: RunDesignations,
        restOfSeason: Boolean,
        zone: ZoneId,
        now: Instant,
    ): String {
        val said = if (status.seasonLong) seasonLongLine(status, capture.readAt, restOfSeason, zone) else weekNote(status)
        return "${said ?: RowStatuses.word(status.status)} ${captureLine(capture, now, zone)}"
    }

    /** designation.ts seasonLongLine: "On injured reserve since September 24. Our projection assumes he
     * plays, so he sits below the available players." */
    private fun seasonLongLine(
        status: RunPlayerStatus,
        readAt: String,
        restOfSeason: Boolean,
        zone: ZoneId,
    ): String? {
        val since = instantOrNull(status.since)
        val stood =
            if (status.since == null) {
                instantOrNull(readAt)?.let { "as of ${Format.monthDay(it, zone)}" } ?: return null
            } else {
                since?.let { "since ${Format.monthDay(it, zone)}" } ?: return null
            }
        val figure = if (restOfSeason) "Our rest-of-season figure" else "Our projection"
        return "${RowStatuses.word(status.status)} $stood. $figure assumes he plays, so he sits below the available players."
    }

    /** status-view.ts weekNote: "Doubtful on the latest report, ...", one due back "Expected back Sun Oct 25
     * on the latest report, ...". */
    private fun weekNote(status: RunPlayerStatus): String {
        val returning = status.returning
        val word =
            if (returning != null && !status.seasonLong) {
                "Expected back ${RowStatuses.calendarDay(returning, weekday = true)}"
            } else {
                RowStatuses.word(status.status)
            }
        return "$word on the latest report, which does not move his place on our board."
    }

    /** designation.ts captureLine: the capture and when it was read, "read" only for a real check; past a
     * day and a half since, how old the statuses are. */
    private fun captureLine(
        capture: RunDesignations,
        now: Instant,
        zone: ZoneId,
    ): String {
        val checked = instantOrNull(capture.checkedAt)
        val listed = instantOrNull(capture.readAt)
        val whenRead =
            if (checked == null) {
                "as the list stood ${listed?.let { Format.stampAt(it, zone) } ?: capture.readAt}"
            } else {
                "read ${Format.stampAt(checked, zone)}"
            }
        val last = checked ?: listed
        if (last != null && Duration.between(last, now) > CAPTURE_BEHIND) {
            return "These injury statuses are from the hourly capture, $whenRead, over a day and a half before now. " +
                "Players keep them until a newer list is read."
        }
        return "Injury status from the hourly capture, $whenRead."
    }

    /** note-words.ts contextNote for a player page's figures, with no account's exact rules: the league's
     * scoring, and what these figures are against it; null where the figures have no board format or the
     * league's scoring or board is one this build does not know. */
    fun league(
        host: LeagueHost,
        scoring: ScoringPreset?,
        format: BoardFormat?,
        figures: String?,
    ): String? {
        val words = scoring?.let(::scoringWords) ?: return null
        val board = format?.takeUnless { it == BoardFormat.unknown_default_open_api } ?: return null
        val shown = figures?.let { id -> BoardFormat.entries.firstOrNull { it.value == id } } ?: return null
        val scores =
            if (scoring == ScoringPreset.te_premium) {
                "Your league gives tight ends extra points per catch."
            } else {
                "Your league scores $words."
            }
        return when {
            board != shown -> "$scores We have no ${figuresWords(board)} board yet, so these figures are ${figuresWords(shown)}."
            scoring == ScoringPreset.te_premium ->
                "$scores These figures are ${figuresWords(shown)}, nearest ${BasisParts.rulesOwner(host)}'s rules."
            board == BoardFormat.superflex -> "Your league scores $words and starts a superflex."
            else -> scores
        }
    }

    /** names.ts SCORING_WORDS, generated; null for a scoring this build does not know. */
    private fun scoringWords(scoring: ScoringPreset): String? =
        when (scoring) {
            ScoringPreset.ppr -> Words.Scoring.ppr
            ScoringPreset.half_ppr -> Words.Scoring.half_ppr
            ScoringPreset.standard -> Words.Scoring.standard
            ScoringPreset.te_premium -> Words.Scoring.te_premium
            else -> null
        }

    /** note-words.ts figuresWords: the format's label mid-sentence ("half PPR"), generated. */
    private fun figuresWords(format: BoardFormat): String {
        val label =
            when (format) {
                BoardFormat.ppr -> Words.FormatLabel.ppr
                BoardFormat.half_ppr -> Words.FormatLabel.half_ppr
                BoardFormat.standard -> Words.FormatLabel.standard
                BoardFormat.te_premium -> Words.FormatLabel.te_premium
                BoardFormat.superflex -> Words.FormatLabel.superflex
                BoardFormat.two_flex -> Words.FormatLabel.two_flex
                BoardFormat.dynasty -> Words.FormatLabel.dynasty
                BoardFormat.best_ball -> Words.FormatLabel.best_ball
                BoardFormat.unknown_default_open_api -> format.value
            }
        return midSentence(label)
    }

    /** sentence.ts midSentence: a capital opening a word of lower case lowered ("Half PPR" to "half PPR"). */
    private fun midSentence(label: String): String =
        if (label.length > 1 && label[0].isUpperCase() && label[1].isLowerCase()) label.replaceFirstChar { it.lowercase() } else label
}
