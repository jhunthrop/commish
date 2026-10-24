package app.trycommish.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** How a column draws its cells: a plain word, the row's name (the biggest, it takes the room left),
 * or a number (the number face, tabular, right-aligned). */
enum class CellKind { Plain, Name, Number }

/** A column of a box score: its head, its width (null fills what is left), and its kind. */
data class BoxColumn(
    val head: String,
    val width: Dp? = null,
    val kind: CellKind = CellKind.Number,
)

/** A row: its cells in the columns' order, whether it is the member's own (drawn on the accent wash),
 * and a short word under its name, such as a streak. */
data class BoxRow(
    val key: String,
    val cells: List<String>,
    val mine: Boolean = false,
    val note: String? = null,
)

private val ROW_HEIGHT = 44.dp
private val HEAD_HEIGHT = 28.dp

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
        BoxLine(HEAD_HEIGHT) {
            columns.forEach { column ->
                Cell(column, column.head.uppercase(), Faces.label.copy(color = c.ink3))
            }
        }
        HorizontalDivider(color = c.lineStrong)
        rows.forEach { row ->
            BoxLine(ROW_HEIGHT, if (row.mine) Modifier.background(c.accentWash) else Modifier) {
                columns.forEachIndexed { i, column ->
                    Cell(column, row.cells.getOrElse(i) { "" }, cellStyle(column.kind), row.note.takeIf { column.kind == CellKind.Name })
                }
            }
            HorizontalDivider(color = c.line)
        }
    }
}

@Composable
private fun cellStyle(kind: CellKind): TextStyle {
    val c = CommishTheme.colors
    return when (kind) {
        CellKind.Number -> Faces.cell.copy(color = c.ink)
        CellKind.Name -> Faces.body.copy(color = c.ink, fontWeight = FontWeight.Medium)
        CellKind.Plain -> Faces.body.copy(color = c.ink2)
    }
}

@Composable
private fun BoxLine(
    height: Dp,
    modifier: Modifier = Modifier,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier.fillMaxWidth().heightIn(min = height).padding(horizontal = Tokens.Space.s2.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

@Composable
private fun RowScope.Cell(
    column: BoxColumn,
    text: String,
    style: TextStyle,
    note: String? = null,
) {
    val width = column.width
    val modifier = (if (width != null) Modifier.width(width) else Modifier.weight(1f)).padding(horizontal = 2.dp)
    val align = if (column.kind == CellKind.Number) TextAlign.End else TextAlign.Start
    Column(modifier) {
        Text(text, style = style, textAlign = align, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth())
        if (note != null) Text(note, style = Faces.small.copy(color = CommishTheme.colors.ink3), maxLines = 1)
    }
}
