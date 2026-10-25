package app.trycommish.feature.start

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.trycommish.core.start.StartModel
import app.trycommish.core.start.StartWords
import app.trycommish.core.start.StripChip
import app.trycommish.core.start.StripSum
import app.trycommish.design.ArrowMark
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.clickableLink
import app.trycommish.feature.boxscore.edgeRule
import app.trycommish.feature.boxscore.wrapCenter

private val SUM_WIDTH = 180.dp
private val CHIP_HEIGHT = 24.dp
private val EDGE = 4.dp
private const val TRACKING = 0.08

/** The Lineup's decision as a strip (web LineupStrip.svelte at 390): the week and the count of changes,
 * the figure the swaps add to the lineup as the platform holds it, each spot no one can play and each
 * swap as a chip, and the API's miss line across the foot. The stamp of a saved read under the title. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun Strip(
    model: StartModel,
    stamp: String?,
    openRecord: () -> Unit,
    /** Each chip as laid out, by its key, and whether it is drawn whole: the snapshot test's check that the
     * strip hides none. */
    chipShown: (key: String, whole: Boolean) -> Unit = { _, _ -> },
) {
    val c = CommishTheme.colors
    val shape = RoundedCornerShape(Tokens.Radius.md.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(c.surface)
            .edgeRule(c.accent, EDGE)
            .border(1.dp, c.line, shape)
            .semantics(mergeDescendants = false) { contentDescription = model.decision },
    ) {
        Column(Modifier.padding(Tokens.Space.s4.dp).padding(start = EDGE), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp)) {
                Head(model, stamp, Modifier.weight(1f))
                Sum(model, openRecord)
            }
            if (model.chips.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    model.chips.forEach { chip ->
                        Chip(
                            chip,
                            Modifier.onGloballyPositioned {
                                chipShown(chip.key, it.boundsInWindow().height >= it.size.height - WHOLE_SLACK)
                            },
                        )
                    }
                }
            }
            model.missed?.let { missed ->
                Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
                    HorizontalDivider(color = c.line)
                    Text(missed, style = Faces.small, color = c.ink)
                }
            }
        }
    }
}

@Composable
private fun Head(
    model: StartModel,
    stamp: String?,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            model.week.uppercase(),
            style = Faces.label.copy(fontWeight = FontWeight.Bold, letterSpacing = TRACKING.em),
            color = c.accentText,
        )
        Text(
            model.title.uppercase(),
            style = Faces.figure,
            color = c.ink,
            maxLines = 2,
            modifier = Modifier.semantics { heading() },
        )
        stamp?.let { Text(it, style = Faces.label.copy(letterSpacing = 0.sp), color = c.accentText) }
    }
}

@Composable
private fun Sum(
    model: StartModel,
    openRecord: () -> Unit,
) {
    val c = CommishTheme.colors
    Column(Modifier.widthIn(max = SUM_WIDTH), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        model.sum?.let { sum ->
            Text(sum.figure, style = Faces.figure, color = c.accentText)
            Text(sumWords(sum), style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp), textAlign = TextAlign.End)
            sum.final?.let { Text(it, style = Faces.cell.copy(fontWeight = FontWeight.Bold, fontSize = Tokens.Type.md.sp), color = c.ink2) }
        }
        model.done?.let {
            Text(
                it,
                style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp),
                color = c.ink3,
                textAlign = TextAlign.End,
            )
        }
        Link(Words.Lineup.pastWeeks, openRecord)
    }
}

/** "Proj with them, 74.7 as set on FFPC, +24.2": the gain in the gain's ink. */
@Composable
private fun sumWords(sum: StripSum) =
    buildAnnotatedString {
        val c = CommishTheme.colors
        withStyle(SpanStyle(color = c.ink3)) { append(sum.words) }
        sum.gain?.let { gain ->
            withStyle(SpanStyle(color = c.ink3)) { append(", ") }
            withStyle(SpanStyle(color = c.gainInk, fontWeight = FontWeight.Bold)) { append(gain) }
        }
    }

/** A quiet link, underlined in the third ink. */
@Composable
private fun Link(
    words: String,
    open: () -> Unit,
) {
    Text(
        words,
        style = Faces.label.copy(fontWeight = FontWeight.Normal, letterSpacing = 0.sp, textDecoration = TextDecoration.Underline),
        color = CommishTheme.colors.ink3,
        textAlign = TextAlign.End,
        modifier = Modifier.clickableLink(words, open),
    )
}

/** A chip: a spot no one can play in the loss's ink, or a swap as the phone names it, the slot then who
 * comes in (the bench row's arrow names who goes out). */
@Composable
private fun Chip(
    chip: StripChip,
    modifier: Modifier,
) {
    val c = CommishTheme.colors
    val pill = RoundedCornerShape(Tokens.Radius.pill.dp)
    when (chip) {
        is StripChip.Idle ->
            Text(
                chip.words,
                style = Faces.small.copy(fontSize = Tokens.Type.xs.sp),
                color = c.lossInk,
                modifier =
                    modifier
                        .height(CHIP_HEIGHT)
                        .background(c.bg, pill)
                        .border(1.dp, c.lossInk.copy(alpha = LOSS_EDGE), pill)
                        .padding(horizontal = Tokens.Space.s2.dp)
                        .wrapCenter(),
            )
        is StripChip.SwapChip ->
            Row(
                modifier
                    .height(CHIP_HEIGHT)
                    .background(c.bg, pill)
                    .border(1.dp, c.lineStrong, pill)
                    .padding(start = 3.dp, end = Tokens.Space.s2.dp)
                    .semantics(mergeDescendants = true) { contentDescription = StartWords.swap(chip.swap) },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    chip.swap.slot,
                    style = Faces.cell.copy(fontSize = Tokens.Type.xs.sp, fontWeight = FontWeight.Bold),
                    color = c.ink,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.background(c.surface2, pill).widthIn(min = 28.dp).padding(horizontal = 4.dp),
                )
                ArrowMark(starts = true, side = 16.dp)
                Text(
                    "${chip.swap.into} ${Words.Lineup.swapIn}",
                    style = Faces.small.copy(fontSize = Tokens.Type.xs.sp, fontWeight = FontWeight.Bold),
                    color = c.ink,
                )
            }
    }
}

private const val LOSS_EDGE = 0.4f

/** Under a pixel short of its height still counts as drawn whole. */
private const val WHOLE_SLACK = 0.5f
