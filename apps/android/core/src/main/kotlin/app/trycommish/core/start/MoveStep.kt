package app.trycommish.core.start

import app.trycommish.api.ApiFailure
import app.trycommish.api.models.HostMovePlan
import app.trycommish.api.models.HostMoveResult
import app.trycommish.core.waivers.WaiverWords
import app.trycommish.design.Words
import java.time.ZoneId

/** The two moves made from our screens (move.ts MoveKind): the Start screen's lineup and the Waivers
 * screen's claim, whose queued answer is said on the member's clock. */
sealed interface MoveKind {
    data object Lineup : MoveKind

    data class Claim(
        val zone: ZoneId,
    ) : MoveKind

    /** words.ts verbWords: "Set it on ESPN", "Claim on ESPN". */
    fun verb(platform: String): String =
        when (this) {
            Lineup -> StartWords.setItOn(platform)
            is Claim -> WaiverWords.claimOn(platform)
        }

    /** move.ts readingWords. */
    fun reading(platform: String): String =
        when (this) {
            Lineup -> StartWords.reading(platform)
            is Claim -> WaiverWords.reading(platform)
        }

    /** move.ts settingWords. */
    fun setting(platform: String): String =
        when (this) {
            Lineup -> StartWords.setting(platform)
            is Claim -> WaiverWords.claiming(platform)
        }

    /** move.ts lostWords. */
    fun lost(platform: String): String =
        when (this) {
            Lineup -> StartWords.lost(platform)
            is Claim -> WaiverWords.lost(platform)
        }

    /** move.ts resultWords: a claim the platform's queue holds says when it runs. */
    fun result(
        platform: String,
        result: HostMoveResult,
    ): String =
        when (this) {
            Lineup -> result.sentence
            is Claim -> WaiverWords.result(platform, result, zone)
        }
}

/** Where the move's confirmation is (move.ts MoveStep): reading the lineup on the platform, the move in
 * the API's words to confirm with its token, on its way, what it came to, unavailable here (the
 * platform's page), or failed (the API's sentence, or ours when no answer came). */
sealed interface MoveStep {
    data object Closed : MoveStep

    data object Planning : MoveStep

    data class Confirm(
        val sentence: String,
        val token: String,
    ) : MoveStep

    data class Sending(
        val sentence: String,
    ) : MoveStep

    data class Answered(
        val result: HostMoveResult,
    ) : MoveStep

    data class Unavailable(
        val sentence: String,
        val page: String?,
    ) : MoveStep

    data class Failed(
        val sentence: String,
        val page: String?,
    ) : MoveStep

    /** Which call failed: nothing was sent when the plan failed, and the move may have left when the
     * make failed. */
    enum class Stage { Plan, Make }

    companion object {
        /** move.ts planStep: the move to confirm, or the platform's page when the API cannot make it. */
        fun planned(plan: HostMovePlan): MoveStep {
            val token = plan.confirm
            if (plan.status == HostMovePlan.Status.ready && token != null) return Confirm(plan.sentence, token)
            return Unavailable(plan.sentence, plan.hostUrl.ifEmpty { null })
        }

        /** move.ts resultStep: what the move came to, or the platform's page when it was unavailable. */
        fun made(result: HostMoveResult): MoveStep =
            if (result.outcome == HostMoveResult.Outcome.unavailable) {
                Unavailable(result.sentence, result.hostUrl.ifEmpty { null })
            } else {
                Answered(result)
            }

        /** move.ts failedStep: the API's own sentence for a refusal it answered (the field that names
         * what it refused, a spent token's `confirm` or a fresh read's `move`, before its message); with
         * no answer, nothing was sent when the plan failed, and the move may have left when the make
         * failed, so the member is sent to check the platform. */
        fun failed(
            error: Exception,
            stage: Stage,
            platform: String,
            page: String?,
            kind: MoveKind = MoveKind.Lineup,
        ): MoveStep {
            val said = (error as? ApiFailure)?.let { it.fields["confirm"] ?: it.fields["move"] ?: it.message }
            if (!said.isNullOrEmpty()) return Failed(said, null)
            return when (stage) {
                Stage.Plan -> Failed(Words.Move.notReached, null)
                Stage.Make -> Failed(kind.lost(platform), page)
            }
        }
    }
}

/** The confirmation as the panel pinned above the bar draws it (MovePanel.svelte): its lines, the verb
 * that makes the move, the platform's page and the way out. Never a retry, never a second confirm. */
data class MovePanel(
    /** The move, what it came to, or why it cannot be made. */
    val line: String,
    val tone: Tone = Tone.Plain,
    /** The platform's reason under a refusal, in its own words. */
    val said: String? = null,
    /** The verb that makes the move ("Set it on ESPN", "Setting it on ESPN" while it is sent). */
    val verb: String? = null,
    val verbEnabled: Boolean = false,
    /** The platform's page: the solid verb where the move cannot be made here, else a quiet link ("Open
     * ESPN") beside a refusal, a move not shown yet or a failure. */
    val page: FootRun? = null,
    val pageSolid: Boolean = false,
    /** The way out: Not now, or Done once the move has answered; null while it is sent. */
    val close: String? = null,
) {
    enum class Tone { Plain, Quiet, Problem }

    /** The panel with its verb held while it waits (a claim planned again for a new bid: the verb makes
     * only the bid the sentence names). */
    fun waiting(waits: Boolean): MovePanel = copy(verbEnabled = verbEnabled && !waits)

    companion object {
        fun of(
            step: MoveStep,
            platform: String,
            kind: MoveKind = MoveKind.Lineup,
        ): MovePanel? {
            val open = { url: String? -> url?.let { FootRun(StartWords.open(platform), it) } }
            return when (step) {
                MoveStep.Closed -> null
                MoveStep.Planning -> MovePanel(kind.reading(platform), Tone.Quiet)
                is MoveStep.Confirm ->
                    MovePanel(step.sentence, verb = kind.verb(platform), verbEnabled = true, close = Words.Move.notNow)
                is MoveStep.Sending -> MovePanel(step.sentence, verb = kind.setting(platform))
                is MoveStep.Answered -> answered(step.result, platform, kind, open)
                is MoveStep.Unavailable ->
                    MovePanel(
                        step.sentence,
                        page = step.page?.let { FootRun(kind.verb(platform), it) },
                        pageSolid = true,
                        close = Words.Move.notNow,
                    )
                is MoveStep.Failed -> MovePanel(step.sentence, Tone.Problem, page = open(step.page), close = Words.Move.notNow)
            }
        }

        private fun answered(
            result: HostMoveResult,
            platform: String,
            kind: MoveKind,
            open: (String?) -> FootRun?,
        ): MovePanel {
            val refused = result.outcome == HostMoveResult.Outcome.refused
            val done = result.outcome == HostMoveResult.Outcome.done
            return MovePanel(
                kind.result(platform, result),
                said = if (refused) result.hostWords?.let { StartWords.platformSaid(platform, it) } else null,
                page = if (done) null else open(result.hostUrl.ifEmpty { null }),
                close = Words.Move.done,
            )
        }
    }
}
