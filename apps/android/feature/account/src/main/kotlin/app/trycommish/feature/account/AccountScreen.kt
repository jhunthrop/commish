package app.trycommish.feature.account

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.trycommish.core.AppWords
import app.trycommish.core.account.AccountModel
import app.trycommish.core.account.AccountSection
import app.trycommish.core.account.AccountState
import app.trycommish.core.account.AccountUi
import app.trycommish.core.account.PushKind
import app.trycommish.core.account.QuietEnd
import app.trycommish.design.CommishTheme
import app.trycommish.design.Tokens
import app.trycommish.feature.boxscore.ScreenFailed

/** What the Account's rows do, handed in by the tab that owns the view model (or nothing, for a
 * snapshot). */
class AccountActions(
    val openLeague: (String) -> Unit = {},
    val detach: (String) -> Unit = {},
    val restore: (String) -> Unit = {},
    val unpair: (String) -> Unit = {},
    val toggle: (PushKind, Boolean) -> Unit = { _, _ -> },
    val editQuiet: (QuietEnd) -> Unit = {},
    val signOut: () -> Unit = {},
    val deleteAccount: () -> Unit = {},
    val openLink: (String) -> Unit = {},
    val refresh: () -> Unit = {},
)

/** The screen's runs, top to bottom, each a snapshot of its own: who with sign out, the leagues followed
 * and the plan; the push switches; the paired devices and the page's foot. */
enum class AccountPart { Top, Switches, Devices }

/** The Account with its view model's state (the iOS AccountView's twin): the saved account at once, then
 * the API's; a pull reads again. The screen decides nothing. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(
    ui: AccountUi,
    stamp: String?,
    refreshing: Boolean,
    actions: AccountActions,
    modifier: Modifier = Modifier,
) {
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = actions.refresh,
        modifier = modifier.fillMaxSize().background(CommishTheme.colors.bg),
    ) {
        when (val state = ui.state) {
            AccountState.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
            AccountState.SignedOut -> ScreenFailed(AppWords.signedOut, null)
            is AccountState.Failed -> AccountFailed(state.message, actions)
            is AccountState.Loaded ->
                AccountPage(state.model, ui, stamp, actions, modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()))
        }
    }
}

/** Nothing to show: the sentence for why, the way to read again, and sign out, as the iOS screen offers
 * it, so a member can always leave. */
@Composable
private fun AccountFailed(
    message: String,
    actions: AccountActions,
) {
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.weight(1f)) { ScreenFailed(message, actions.refresh) }
        SignOutButton(busy = false, onClick = actions.signOut)
    }
}

/** The Account as its model says it, in the web's order on a phone (AccountPage.svelte): who and sign
 * out, the leagues followed, the plan, then the switches the app adds, the paired devices and the foot.
 * Drawn whole, or the parts a snapshot asks for. */
@Composable
fun AccountPage(
    model: AccountModel,
    ui: AccountUi,
    stamp: String?,
    actions: AccountActions,
    parts: List<AccountPart> = AccountPart.entries,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.background(CommishTheme.colors.bg).padding(horizontal = Tokens.Space.s4.dp, vertical = Tokens.Space.s5.dp),
        verticalArrangement = Arrangement.spacedBy(Tokens.Space.s6.dp),
    ) {
        parts.forEach { part ->
            when (part) {
                AccountPart.Top -> {
                    WhoView(model, stamp, busy = ui.busy != null, signOut = actions.signOut)
                    AccountLeagues(model, ui, actions)
                    model.plan?.let { PlanView(it, actions.openLink) }
                }
                AccountPart.Switches ->
                    PushSwitches(
                        ui.shownPush,
                        ui.permission,
                        ui.problem?.takeIf { it.section == AccountSection.Notifications }?.text,
                        actions.toggle,
                        actions.editQuiet,
                    )
                AccountPart.Devices -> {
                    AccountDevices(model, ui, actions.unpair)
                    AccountFoot(actions.deleteAccount, actions.openLink)
                }
            }
        }
    }
}
