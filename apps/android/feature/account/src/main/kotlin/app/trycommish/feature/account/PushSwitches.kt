package app.trycommish.feature.account

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDefaults
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.trycommish.core.account.AccountWords
import app.trycommish.core.account.PushKind
import app.trycommish.core.account.PushSettings
import app.trycommish.core.account.QuietEnd
import app.trycommish.core.push.PushPermission
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BasisText
import kotlinx.coroutines.flow.drop

private const val MINUTES_IN_AN_HOUR = 60

/** The push switches (spec §5.3): one per kind with what it sends, then quiet hours with their two ends,
 * and under them where the switches are kept and, while the phone may not show a push, what a switch does
 * or where to allow it; a write that failed says so. `push` is the switches as drawn. */
@Composable
internal fun PushSwitches(
    push: PushSettings,
    permission: PushPermission,
    problem: String?,
    toggle: (PushKind, Boolean) -> Unit,
    editQuiet: (QuietEnd) -> Unit,
) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        SectionHead(Words.Push.title)
        Column {
            PushKind.entries.forEach { kind ->
                KeyRow(trailing = {
                    Switch(
                        checked = push.on(kind),
                        onCheckedChange = { toggle(kind, it) },
                        colors =
                            SwitchDefaults.colors(
                                checkedTrackColor = c.accent,
                                checkedThumbColor = c.accentInk,
                                checkedBorderColor = c.accent,
                                uncheckedTrackColor = c.surface2,
                                uncheckedThumbColor = c.ink3,
                                uncheckedBorderColor = c.lineStrong,
                            ),
                        modifier = Modifier.semantics { contentDescription = name(kind) },
                    )
                }) { Named(name(kind), line(kind)) }
            }
            KeyRow(trailing = {}) { Named(Words.Push.quiet, Words.Push.quietLine) }
            Row(Modifier.padding(vertical = Tokens.Space.s2.dp), horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
                QuietEndButton(Words.Push.from, AccountWords.clockTime(push.quietFrom), Modifier.weight(1f)) { editQuiet(QuietEnd.From) }
                QuietEndButton(Words.Push.to, AccountWords.clockTime(push.quietTo), Modifier.weight(1f)) { editQuiet(QuietEnd.To) }
            }
        }
        problem?.let { ProblemText(it) }
        BasisText(AccountWords.pushFoot(permission))
    }
}

@Composable
private fun Named(
    name: String,
    line: String,
) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(name, style = Faces.body.copy(fontWeight = FontWeight.Bold), color = c.ink)
        Text(line, style = Faces.small, color = c.ink2)
    }
}

/** One end of quiet hours: its label over its time; a tap opens the time picker. */
@Composable
private fun QuietEndButton(
    label: String,
    time: String,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Column(
        modifier
            .clip(shape)
            .background(c.surface)
            .border(1.dp, c.line, shape)
            .clickable(onClickLabel = label, role = Role.Button, onClick = onClick)
            .padding(horizontal = Tokens.Space.s3.dp, vertical = Tokens.Space.s2.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label.uppercase(), style = Faces.label, color = c.ink3)
        Text(time, style = Faces.number(NumWeight.Bold, Faces.figure.fontSize), color = c.accentText)
    }
}

/** One end of quiet hours on the system's time picker, in a dialog, written as it turns (the iOS wheel's
 * way); Close puts the dialog away. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuietHoursDialog(
    end: QuietEnd,
    push: PushSettings,
    save: (Int) -> Unit,
    dismiss: () -> Unit,
) {
    val c = CommishTheme.colors
    val minutes = push.minutes(end)
    val state = rememberTimePickerState(minutes / MINUTES_IN_AN_HOUR, minutes % MINUTES_IN_AN_HOUR, is24Hour = false)
    LaunchedEffect(state) {
        snapshotFlow { state.hour * MINUTES_IN_AN_HOUR + state.minute }.drop(1).collect(save)
    }
    AlertDialog(
        onDismissRequest = dismiss,
        containerColor = c.bg,
        title = {
            SectionHead(Words.Push.quiet, if (end == QuietEnd.From) Words.Push.from else Words.Push.to)
        },
        text = {
            TimePicker(
                state,
                colors =
                    TimePickerDefaults.colors(
                        selectorColor = c.accent,
                        timeSelectorSelectedContainerColor = c.accentWash,
                        timeSelectorSelectedContentColor = c.accentText,
                        periodSelectorSelectedContainerColor = c.accentWash,
                        periodSelectorSelectedContentColor = c.accentText,
                    ),
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            QuietButton(Words.Shelf.close, onClick = dismiss)
        },
    )
}

/** A kind's name, as the switch is labelled. */
private fun name(kind: PushKind): String =
    when (kind) {
        PushKind.Thursday -> Words.Push.thursday
        PushKind.Status -> Words.Push.status
        PushKind.Waivers -> Words.Push.waivers
    }

/** What a kind sends, under its name. */
private fun line(kind: PushKind): String =
    when (kind) {
        PushKind.Thursday -> Words.Push.thursdayLine
        PushKind.Status -> Words.Push.statusLine
        PushKind.Waivers -> Words.Push.waiversLine
    }
