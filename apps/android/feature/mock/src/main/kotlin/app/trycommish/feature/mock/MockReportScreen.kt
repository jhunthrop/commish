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
import app.trycommish.feature.companion.ReportPart

/** The report's verbs (the report page's): the solid one that runs the draft again, then the quiet ones. A
 * shared draft's report has its own lead and no link of its own to copy. */
class MockReportVerbs(
    val lead: String,
    val run: () -> Unit = {},
    val another: (() -> Unit)? = null,
    val copied: Boolean = false,
    val copy: (() -> Unit)? = null,
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
            verbs.another?.let { QuietButton(Words.Mock.tryAnother, onClick = it) }
            verbs.copy?.let { QuietButton(if (verbs.copied) Words.Mock.copied else Words.Mock.copyLink, onClick = it) }
        }
    }
}
