package app.trycommish.feature.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.trycommish.core.account.AccountDeviceRow
import app.trycommish.core.account.AccountModel
import app.trycommish.core.account.AccountSection
import app.trycommish.core.account.AccountUi
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Pill
import app.trycommish.design.PillTone
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Words

/** The paired devices (hosts/AccountDevices.svelte): each device's name and line, this phone marked, and
 * Unpair. Shown once the account has a paired device, as the web's list is. */
@Composable
internal fun AccountDevices(
    model: AccountModel,
    ui: AccountUi,
    unpair: (String) -> Unit,
) {
    if (model.devices.isEmpty()) return
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        SectionHead(Words.Devices.title, model.devicesAside)
        Column {
            model.devices.forEach { device ->
                KeyRow(trailing = { QuietButton(verb(device, ui.busy), enabled = ui.busy == null) { unpair(device.id) } }) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp),
                        ) {
                            Text(device.name, style = Faces.body.copy(fontWeight = FontWeight.Bold), color = c.ink)
                            if (device.thisPhone) Pill(Words.Devices.thisPhone, PillTone.Accent)
                        }
                        Text(device.line, style = Faces.small, color = c.ink2)
                    }
                }
            }
        }
        ui.problem?.takeIf { it.section == AccountSection.Devices }?.let { ProblemText(it.text) }
    }
}

/** This phone's verb is Sign out, what unpairing it does; another device's is Unpair. */
private fun verb(
    device: AccountDeviceRow,
    busy: String?,
): String =
    when {
        device.thisPhone -> Words.Account.signOut
        busy == device.id -> Words.Devices.unpairing
        else -> Words.Devices.unpair
    }
