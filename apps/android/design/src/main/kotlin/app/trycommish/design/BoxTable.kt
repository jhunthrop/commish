package app.trycommish.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** A column of a box score: its head, its width (null fills what is left), and whether it holds
 * numbers (the number face, tabular, right-aligned). */
data class BoxColumn(
    val head: String,
    val width: Dp? = null,
    val numeric: Boolean = false,
)

/** A row: its cells in the columns' order, and whether it is the member's own (drawn on the accent
 * wash). */
data class BoxRow(
    val key: String,
    val cells: List<String>,
    val mine: Boolean = false,
)

private val ROW_HEIGHT = 40.dp

/** A box score: a head row of labels, then one row per entry, columns of numbers that line up. The one
 * table every screen draws its numbers with. */
@Composable
fun BoxTable(
    columns: List<BoxColumn>,
    rows: List<BoxRow>,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Column(modifier.fillMaxWidth()) {
        BoxLine(columns, columns.map { it.head.uppercase() }, isHead = true)
        HorizontalDivider(color = c.lineStrong)
        rows.forEach { row ->
            BoxLine(
                columns,
                row.cells,
                isHead = false,
                modifier = if (row.mine) Modifier.background(c.accentWash) else Modifier,
            )
            HorizontalDivider(color = c.line)
        }
    }
}

@Composable
private fun BoxLine(
    columns: List<BoxColumn>,
    cells: List<String>,
    isHead: Boolean,
    modifier: Modifier = Modifier,
) {
    val c = CommishTheme.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = if (isHead) 28.dp else ROW_HEIGHT).padding(horizontal = Tokens.Space.s2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        columns.forEachIndexed { i, column ->
            val style =
                when {
                    isHead -> Faces.label.copy(color = c.ink3)
                    column.numeric -> Faces.cell.copy(color = c.ink)
                    i == 1 -> Faces.body.copy(color = c.ink, fontWeight = FontWeight.Medium)
                    else -> Faces.body.copy(color = c.ink2)
                }
            val width = column.width
            Text(
                text = cells.getOrElse(i) { "" },
                style = style,
                textAlign = if (column.numeric) TextAlign.End else TextAlign.Start,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = if (width != null) Modifier.width(width) else Modifier.weight(1f),
            )
        }
    }
}
