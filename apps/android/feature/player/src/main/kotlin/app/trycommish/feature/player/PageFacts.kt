package app.trycommish.feature.player

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.trycommish.core.Format
import app.trycommish.core.board.Heat
import app.trycommish.core.player.PlayerPageModel
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.NumWeight
import app.trycommish.design.ThemedColor
import app.trycommish.design.Tokens
import app.trycommish.design.resolve
import kotlin.math.max

/** The outcome bar's track and its median mark. */
private const val TRACK_HEIGHT = 8
private const val MARK_HEIGHT = 16
private const val MARK_WIDTH = 3

/** The facts before the season (Fact.svelte): where drafters take him, his value over a pickup's with its
 * round's tint, and his floor, median and ceiling. */
@Composable
fun PageFacts(facts: PlayerPageModel.Facts) {
    Column {
        FactRow(facts.drafters, null)
        FactRow(facts.overReplacement, tintOf(facts.heat))
        facts.outcomes?.let { OutcomesRow(it) }
        HorizontalDivider(color = CommishTheme.colors.line)
    }
}

/** ui/heat.ts's tint for a round, none past the fourth. */
private fun tintOf(heat: Heat): ThemedColor? =
    when (heat) {
        is Heat.Round ->
            when (heat.round) {
                1 -> Tokens.Color.heat1
                2 -> Tokens.Color.heat2
                3 -> Tokens.Color.heat3
                else -> Tokens.Color.heat4
            }
        Heat.Below -> Tokens.Color.heatNeg
        Heat.None -> null
    }

/** One fact: its label, its figure (tinted where the board tints it) and the sentence under it. */
@Composable
private fun FactRow(
    fact: PlayerPageModel.Fact,
    tint: ThemedColor?,
) {
    val c = CommishTheme.colors
    val ground = tint?.resolve(c.dark) ?: Color.Transparent
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        HorizontalDivider(color = c.line)
        SmallHead(fact.label, Modifier.padding(top = Tokens.Space.s2.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp), verticalAlignment = Alignment.Bottom) {
            Text(
                fact.figure,
                style = Faces.figure,
                color = c.ink,
                modifier =
                    Modifier
                        .background(ground, RoundedCornerShape(Tokens.Radius.sm.dp))
                        .padding(horizontal = if (tint == null) 0.dp else Tokens.Space.s1.dp),
            )
            fact.unit?.let { Text(it, style = Faces.label, color = c.ink3) }
        }
        Text(fact.words, style = Faces.small, color = c.ink2, modifier = Modifier.padding(bottom = Tokens.Space.s2.dp))
    }
}

/** Floor, median and ceiling as the web's outcome bar: the range from his low case to his high case with
 * the median marked, each figure under its place. */
@Composable
private fun OutcomesRow(outcomes: PlayerPageModel.Outcomes) {
    val c = CommishTheme.colors
    val span = max(outcomes.ceiling - outcomes.floor, 1.0)
    val median = ((outcomes.median - outcomes.floor) / span).toFloat()
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s1.dp)) {
        HorizontalDivider(color = c.line)
        SmallHead(outcomes.label, Modifier.padding(top = Tokens.Space.s2.dp))
        BoxWithConstraints(Modifier.fillMaxWidth().height(MARK_HEIGHT.dp), contentAlignment = Alignment.CenterStart) {
            Box(Modifier.fillMaxWidth().height(TRACK_HEIGHT.dp).background(c.surface2, RoundedCornerShape(TRACK_HEIGHT.dp)))
            val at = (maxWidth * median - (MARK_WIDTH / 2f).dp).coerceIn(0.dp, maxWidth - MARK_WIDTH.dp)
            Box(
                Modifier
                    .offset(x = at)
                    .width(MARK_WIDTH.dp)
                    .height(MARK_HEIGHT.dp)
                    .background(c.ink2, RoundedCornerShape(2.dp)),
            )
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf(outcomes.floor, outcomes.median, outcomes.ceiling).forEach {
                Text(Format.fixed(it), style = Faces.number(NumWeight.Bold), color = c.ink)
            }
        }
        Text(outcomes.caption, style = Faces.small.copy(fontWeight = FontWeight.Normal), color = c.ink2)
        Box(Modifier.height(Tokens.Space.s1.dp))
    }
}
