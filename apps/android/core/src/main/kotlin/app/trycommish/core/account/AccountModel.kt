package app.trycommish.core.account

import app.trycommish.design.Words
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId

/** A followed league's row as the web's Leagues attached table draws it on a phone. */
data class AccountLeagueRow(
    val id: String,
    val name: String,
    /** "McConkey Kong Country, on Sleeper". */
    val team: String,
    /** "1-4", "--" before a read. */
    val record: String,
    /** "12th of 12", empty before a read. */
    val place: String,
    val season: String,
    /** "4 minutes ago", "Oct 12", "--". */
    val read: String,
    /** Detached a moment ago: its undo shows in place of its verbs. */
    val detached: Boolean,
) {
    /** The phone's line under the row (AccountLeagues.svelte .ph-only): "Last read 4 minutes ago". */
    val readLine: String get() = "${Words.Attached.lastRead} $read"
}

/** A paired device's row: its name, "Paired Oct 12, last used Oct 17", and whether it is this phone. */
data class AccountDeviceRow(
    val id: String,
    val name: String,
    val line: String,
    val thisPhone: Boolean,
)

/** The plan card as the web prints it in the free season (account/words.ts FREE_SEASON_PLAN). The app
 * never draws a price or a paywall: outside the free season, or for a plan bought on the web, there is
 * no card here and the plan is the web's to show. */
data class PlanCard(
    val title: String,
    val line: String,
    val see: String,
) {
    companion object {
        val free = PlanCard(Words.FreePlan.title, Words.FreePlan.line, Words.FreePlan.see)

        /** pass/free-season.ts FREE_SEASON_ENDS, generated (Words.FreeSeason). */
        val freeSeasonEnds: Instant = Instant.parse(Words.FreeSeason.ends)

        /** free-season.ts freeSeasonAt: the API's `free_season` whenever it answers one, true or false;
         * only without it (an older API, a failed read) the clock rule, free until the season's end. */
        fun freeSeason(
            now: Instant,
            flag: Boolean?,
        ): Boolean = flag ?: now.isBefore(freeSeasonEnds)

        /** The card for this account at this instant: the free season's, unless the account bought a plan
         * (words.ts boughtPlan), which keeps its own card on the web. */
        fun of(
            account: AccountRead,
            now: Instant,
            flag: Boolean?,
        ): PlanCard? = free.takeIf { freeSeason(now, flag) && !bought(account) }

        fun bought(account: AccountRead): Boolean = account.membership?.source == SUBSCRIPTION || account.draftPass?.source == PURCHASE

        private const val SUBSCRIPTION = "subscription"
        private const val PURCHASE = "purchase"
    }
}

/** What the Account screen reads, kept on the phone for no signal: the account, the leagues followed
 * (null when they could not be read), the paired devices and the API's free-season flag (null when the
 * API sent none or the read failed). */
@Serializable
data class AccountScreenAnswer(
    val me: AccountRead,
    val leagues: List<AttachedRead>?,
    val devices: List<DeviceRead>,
    val freeSeason: Boolean?,
) {
    fun withoutDevice(id: String): AccountScreenAnswer = copy(devices = devices.filter { it.id != id })

    fun withoutLeague(id: String): AccountScreenAnswer = copy(leagues = leagues?.filter { it.id != id })
}

/** The Account screen as the web's account page draws it on a phone: who, the leagues followed, the plan,
 * the paired devices with this phone marked. The push switches are the view model's. */
data class AccountModel(
    val name: String,
    /** "fixture@example.com, with us since Sep 1". */
    val line: String,
    /** Null when the leagues could not be read: the web's sentence says so. */
    val leagues: List<AccountLeagueRow>?,
    val leaguesAside: String?,
    val devices: List<AccountDeviceRow>,
    val devicesAside: String,
    val plan: PlanCard?,
    /** The account may follow another league (many_leagues): the web's Follow another league. */
    val followMore: Boolean,
) {
    companion object {
        fun of(
            answer: AccountScreenAnswer,
            detached: Set<String>,
            thisDevice: String?,
            now: Instant,
            zone: ZoneId,
        ): AccountModel =
            AccountModel(
                name = AccountWords.displayName(answer.me),
                line = AccountWords.whoLine(answer.me),
                leagues = answer.leagues?.map { AccountWords.leagueRow(it, now, zone, it.id in detached) },
                leaguesAside = answer.leagues?.let { AccountWords.attachedCount(it.size) },
                devices =
                    answer.devices.map {
                        AccountDeviceRow(it.id, it.name, AccountWords.deviceLine(it), thisPhone = it.id == thisDevice)
                    },
                devicesAside = AccountWords.deviceCount(answer.devices.size),
                plan = PlanCard.of(answer.me, now, answer.freeSeason),
                followMore = MANY_LEAGUES in answer.me.features,
            )

        private const val MANY_LEAGUES = "many_leagues"
    }
}
