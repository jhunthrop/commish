package app.trycommish.android

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.core.account.AccountState
import app.trycommish.core.account.AccountViewModel
import app.trycommish.core.account.QuietEnd
import app.trycommish.feature.account.AccountActions
import app.trycommish.feature.account.AccountScreen
import app.trycommish.feature.account.DeleteAccountDialog
import app.trycommish.feature.account.QuietHoursDialog

/**
 * The Account, pushed from the top bar: its own view model on the screen's back stack entry, so a detach
 * still in its undo window is made final when the member leaves (the entry's view model is cleared) and
 * not on a rotation. `leaguesChanged` reads the league switch again; `openLeague` shows a league from its
 * row as the switch would. A site link opens in the browser.
 */
@Composable
fun AccountTab(
    graph: AppGraph,
    leaguesChanged: () -> Unit,
    openLeague: (String) -> Unit,
) {
    val vm: AccountViewModel = viewModel(key = "account") { graph.accountViewModel(leaguesChanged) }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val deletion by vm.deletion.ui.collectAsStateWithLifecycle()
    var editing by rememberSaveable { mutableStateOf<QuietEnd?>(null) }
    val context = LocalContext.current
    LaunchedEffect(vm) { vm.load() }
    AccountScreen(
        ui = ui,
        stamp = vm.stampWords(ui),
        refreshing = refreshing && ui.state is AccountState.Loaded,
        actions =
            AccountActions(
                openLeague = openLeague,
                detach = { vm.detach(it) },
                restore = { vm.restore(it) },
                unpair = { vm.unpair(it) },
                toggle = vm::set,
                editQuiet = { editing = it },
                signOut = vm::signOut,
                deleteAccount = vm::openDeletion,
                openLink = { url ->
                    try {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    } catch (e: ActivityNotFoundException) {
                        Log.w("Commish", "open a link", e)
                    }
                },
                refresh = { vm.load() },
            ),
    )
    editing?.let { end ->
        QuietHoursDialog(end, ui.push, save = { vm.setQuiet(end, it) }, dismiss = { editing = null })
    }
    deletion?.let { shown ->
        DeleteAccountDialog(
            shown,
            type = vm.deletion::type,
            delete = { vm.deletion.delete() },
            close = vm.deletion::close,
        )
    }
}
