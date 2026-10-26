package app.trycommish.core.mock

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.BotStyle
import app.trycommish.api.models.League
import app.trycommish.api.models.LeagueSettings
import app.trycommish.api.models.Lineup
import app.trycommish.api.models.MockCreate
import app.trycommish.api.models.RosterCounts
import app.trycommish.api.models.Scoring
import app.trycommish.api.models.ScoringPreset
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.BoardChip
import app.trycommish.design.Words
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The setup's choices (web/src/lib/room/setup/setup.ts), the iOS MockSetup's: the scoring presets, the team
 * counts and the lineups, each with its chip's words. */
object MockSetup {
    val scoring: List<Pair<ScoringPreset, String>> =
        listOf(
            ScoringPreset.ppr to Words.MockSetup.ppr,
            ScoringPreset.half_ppr to Words.MockSetup.half_ppr,
            ScoringPreset.standard to Words.MockSetup.standard,
            ScoringPreset.te_premium to Words.MockSetup.te_premium,
        )
    val teams: List<Int> = listOf(8, 10, 12, 14)
    val lineups: List<Pair<Lineup, String>> =
        listOf(
            Lineup.standard to Words.MockSetup.lineupStandard,
            Lineup.superflex to Words.MockSetup.superflex,
            Lineup.two_flex to Words.MockSetup.twoFlex,
        )

    /** setup.ts defaultSettings: PPR, twelve teams, a random slot, the standard roster and lineup, no keepers,
     * bots by ADP. */
    @Suppress("MagicNumber") // The web's default roster, as setup.ts writes it.
    fun defaults(): LeagueSettings =
        LeagueSettings(
            scoring = Scoring(preset = ScoringPreset.ppr),
            teams = 12,
            slot = null,
            roster = RosterCounts(qb = 1, rb = 2, wr = 2, te = 1, k = 1, dst = 1, bench = 6),
            lineup = Lineup.standard,
            keepers = emptyList(),
            botStyle = BotStyle.adp,
        )

    /** setup.ts inFormat: the settings in the context's board format (its scoring, or a superflex lineup); any
     * other format leaves them as they are. */
    fun inFormat(
        settings: LeagueSettings,
        format: BoardFormat?,
    ): LeagueSettings =
        when (format) {
            BoardFormat.ppr -> settings.copy(scoring = Scoring(preset = ScoringPreset.ppr))
            BoardFormat.half_ppr -> settings.copy(scoring = Scoring(preset = ScoringPreset.half_ppr))
            BoardFormat.standard -> settings.copy(scoring = Scoring(preset = ScoringPreset.standard))
            BoardFormat.superflex -> settings.copy(lineup = Lineup.superflex)
            else -> settings
        }

    /** scoring.ts PPR_FROM and HALF_FROM: the reception points a league's own rules score PPR or half PPR from
     * (api/internal/leaguesync/rules.go NearestPreset). */
    private const val PPR_FROM = 0.75
    private const val HALF_FROM = 0.25

    /** scoring.ts nearestPreset: the preset a league's own rules score most like, by reception points, TE
     * premium when a tight end's catch counts more. */
    fun nearestPreset(
        reception: Double,
        teBonus: Double,
    ): ScoringPreset =
        when {
            reception >= PPR_FROM -> if (teBonus > 0) ScoringPreset.te_premium else ScoringPreset.ppr
            reception >= HALF_FROM -> ScoringPreset.half_ppr
            else -> ScoringPreset.standard
        }

    /** scoring.ts rerunOf: a saved league as this account's mock drafts it, its own rules with custom_scoring,
     * the nearest preset without; `exact` when the mock drafts the league's own rules. */
    fun rerun(
        settings: LeagueSettings,
        exactRules: Boolean,
    ): Pair<LeagueSettings, Boolean> {
        val rules = settings.scoring.custom
        if (exactRules || rules == null) return settings to true
        val preset = nearestPreset(rules.pointsPerReception, rules.teReceptionBonus)
        return settings.copy(scoring = Scoring(preset = preset)) to false
    }
}

/** Where a setup starts from (the web's site context): the context's board format, the saved league the link
 * or the selected league names, and whether the account drafts a league's own rules. */
data class MockSetupSeed(
    val format: BoardFormat? = null,
    val league: String? = null,
    val exactRules: Boolean = false,
)

/** The setup's form: the settings, the saved league it opened on while the form holds it, a start on its
 * way, and a start that did not go. */
data class MockSetupForm(
    val settings: LeagueSettings,
    val opened: League? = null,
    val busy: Boolean = false,
    val problem: String? = null,
    /** The room a start opened, until the screen has opened it. */
    val started: String? = null,
) {
    val cells: List<MockCell> get() = MockWords.setupCells()

    val scoringChips: List<BoardChip<ScoringPreset>>
        get() = MockSetup.scoring.map { (preset, label) -> BoardChip(label, preset, preset == settings.scoring.preset) }

    val teamChips: List<BoardChip<Int>> get() = MockSetup.teams.map { BoardChip(it.toString(), it, it == settings.teams) }

    val lineupChips: List<BoardChip<Lineup>>
        get() = MockSetup.lineups.map { (lineup, label) -> BoardChip(label, lineup, lineup == settings.lineup) }

    /** The slots to choose from: one per team, then Random (null). */
    val slots: List<Int?> get() = (1..settings.teams).toList() + null
}

/**
 * The setup page (web/src/routes/mock/new at 390) for a mock against bots, the iOS MockSetupViewModel's: the
 * clocks, the scoring, the teams, your slot and the lineup, and the one verb that starts it. A start answers
 * the new room's id in `started`, which the screen opens. `from` is a draft's settings to start again from
 * (the report's Try another slot), its slot let go; without it the setup starts in the seed's format, and
 * [load] opens the seed's saved league.
 */
class MockSetupViewModel(
    private val reads: MockReads,
    from: LeagueSettings? = null,
    private val seed: MockSetupSeed = MockSetupSeed(),
    private val sessionEnd: SessionEnd = SessionEnd {},
) : ViewModel() {
    private val rerunning = from != null
    private var openedExact = true
    private var loaded = false
    private val mutableForm =
        MutableStateFlow(MockSetupForm((from ?: MockSetup.inFormat(MockSetup.defaults(), seed.format)).copy(slot = null)))

    val form: StateFlow<MockSetupForm> = mutableForm.asStateFlow()

    /** The saved league the seed names, when the account has it: the form filled with its settings as this
     * account's mock drafts them (the web's openLeague). Once per setup, so a return to the screen never
     * undoes the member's chips; a read that fails leaves the form as it is. */
    fun load(): Job? {
        val id = seed.league
        if (rerunning || loaded || id == null) return null
        loaded = true
        val untouched = mutableForm.value.settings
        return viewModelScope.launch {
            try {
                val league = reads.leagues().firstOrNull { it.id.toString() == id } ?: return@launch
                if (mutableForm.value.settings != untouched) return@launch
                val (settings, exact) = MockSetup.rerun(league.settings, seed.exactRules)
                openedExact = exact
                mutableForm.update { it.copy(settings = settings, opened = league) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Unauthorized) {
                sessionEnd.signedOut()
            } catch (
                @Suppress("TooGenericExceptionCaught", "SwallowedException") e: Exception,
            ) {
                // The form stays as it is.
            }
        }
    }

    fun choose(preset: ScoringPreset) = change { it.copy(scoring = Scoring(preset = preset)) }

    /** setup.ts setTeams: a slot past the new count goes back to Random. */
    fun chooseTeams(teams: Int) = change { it.copy(teams = teams, slot = it.slot?.takeIf { slot -> slot <= teams }) }

    fun choose(lineup: Lineup) = change { it.copy(lineup = lineup) }

    /** A slot keeps the saved league open: the verb then drafts its settings from that slot. */
    fun chooseSlot(slot: Int?) = mutableForm.update { it.copy(settings = it.settings.copy(slot = slot)) }

    /** The room a start opened has been opened. */
    fun opened() = mutableForm.update { it.copy(started = null) }

    /** Any other change lets the saved league go. */
    private fun change(edit: (LeagueSettings) -> LeagueSettings) =
        mutableForm.update { it.copy(settings = edit(it.settings), opened = null) }

    /** actions.ts startMock over the web's mockLeague: the saved league itself when the form drafts it as saved
     * (its own rules, its own slot); its settings otherwise, since the API takes a league or settings, not
     * both. */
    fun body(): MockCreate {
        val form = mutableForm.value
        val opened = form.opened
        if (opened != null && openedExact && form.settings.slot == opened.settings.slot) return MockCreate(leagueId = opened.id)
        return MockCreate(settings = form.settings)
    }

    /** Start against bots: the new room's id in `started`, or the problem saying why it did not start. */
    fun start(): Job? {
        if (mutableForm.value.busy) return null
        mutableForm.update { it.copy(busy = true, problem = null) }
        val body = body()
        return viewModelScope.launch {
            try {
                val id = reads.create(body).id?.toString()
                mutableForm.update { it.copy(busy = false, started = id) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Unauthorized) {
                mutableForm.update { it.copy(busy = false) }
                sessionEnd.signedOut()
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                mutableForm.update { it.copy(busy = false, problem = MockRoomViewModel.sentence(e)) }
            }
        }
    }
}
