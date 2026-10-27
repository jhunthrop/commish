package app.trycommish.feature.mock

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.trycommish.core.companion.DraftReportModel
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Verb
import app.trycommish.design.Words
import app.trycommish.feature.companion.CompanionActions
import app.trycommish.feature.companion.DraftReportScreen
import app.trycommish.feature.companion.NoteText
import app.trycommish.feature.companion.ReportPart

/** The report's verbs (the report page's): the solid one that runs the draft again, then the quiet ones. A
 * shared draft's report has its own lead and no link of its own to copy. */
class MockReportVerbs(
    val lead: String,
    val run: () -> Unit = {},
    val another: (() -> Unit)? = null,
    /** The quiet verb's words: Try another slot, or the lobby's "Run it against bots from slot 5". */
    val anotherLabel: String = Words.Mock.tryAnother,
    val copied: Boolean = false,
    val copy: (() -> Unit)? = null,
    /** A verb the API refused (Run it again), in its words, under the verbs. */
    val refusal: String? = null,
)

/** The report as a box score (Report.svelte at 390), the companion's report with the mock's verbs: the one
 * big number and its caption, the title, the finish and the draft as cells, the verbs, the basis once, the
 * field; then pick by pick and the same draft run again. */
@Composable
fun MockReportScreen(
    report: DraftReportModel,
    verbs: MockReportVerbs,
    modifier: Modifier = Modifier,
    parts: Set<ReportPart> = ReportPart.entries.toSet(),
    open: (SheetPlayer) -> Unit = {},
) {
    DraftReportScreen(report, CompanionActions(open = open), modifier, parts) {
        Verb(verbs.lead, onClick = verbs.run)
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
            verbs.another?.let { QuietButton(verbs.anotherLabel, onClick = it) }
            verbs.copy?.let { QuietButton(if (verbs.copied) Words.Mock.copied else Words.Mock.copyLink, onClick = it) }
        }
        verbs.refusal?.let { NoteText(it) }
    }
}
