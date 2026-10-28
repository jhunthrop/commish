package app.trycommish.android

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.trycommish.api.models.BoardFormat
import app.trycommish.core.sheet.SheetExport
import app.trycommish.core.sheet.SheetLimits
import app.trycommish.core.sheet.SheetPhase
import app.trycommish.core.sheet.SheetViewModel
import app.trycommish.core.sheet.chose
import app.trycommish.core.sheet.closeImport
import app.trycommish.core.sheet.exportFile
import app.trycommish.core.sheet.finishExport
import app.trycommish.core.sheet.importText
import app.trycommish.core.sheet.openImport
import app.trycommish.core.sheet.paste
import app.trycommish.core.sheet.start
import app.trycommish.core.shell.ShellState
import app.trycommish.feature.sheet.SheetActions
import app.trycommish.feature.sheet.SheetPanelActions
import app.trycommish.feature.sheet.SheetRowActions
import app.trycommish.feature.sheet.SheetScreen
import app.trycommish.feature.sheet.SheetView
import app.trycommish.feature.shell.LocalPlayerSheet
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.io.InputStream

/** The bar's Cheat sheet page (nav.ts SHEET), the web's /sheet. */
const val SHEET_PAGE = "sheet"

private const val TAG = "Commish"
private const val CSV_TYPE = "text/csv"

/** The types the file picker offers: a CSV, and plain text a CSV is often saved as. */
private val PICKED_TYPES = arrayOf(CSV_TYPE, "text/comma-separated-values", "text/plain")

/** A byte that is never UTF-8 on its own: a file that could not be read is said as one that is not text. */
private val UNREADABLE = byteArrayOf(0xFF.toByte())

/** The format an empty sheet starts in: the selected league's, else the account's, else PPR (the web's
 * DEFAULT_FORMAT). */
fun sheetFormat(shell: ShellState): BoardFormat {
    val ready = shell as? ShellState.Ready
    return ready?.selected?.format ?: ready?.format ?: BoardFormat.ppr
}

/**
 * The Cheat sheet tab (the iOS SheetTab): one view model for the tab, which keeps an unsaved edit and the
 * open row while the player sheet is over it and when the league shown changes; the league's format is a
 * value it reads only for an empty sheet's start. The saved sheet at once, then the account's; a pull reads
 * again; a row's face and name open the one player sheet, which keeps him as the sheet reads again under it;
 * a CSV chosen through the system's picker is held under its name for the import; the export is handed to
 * the share sheet through the app's file provider; the pinned verb opens a mock draft's setup.
 */
@Composable
fun SheetTab(
    graph: AppGraph,
    shell: ShellState,
    openMock: () -> Unit,
) {
    val format = sheetFormat(shell)
    val vm: SheetViewModel = viewModel(key = "sheet") { graph.sheetViewModel(format) }
    LaunchedEffect(format) { vm.startIn(format) }
    val ui by vm.ui.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val sheet = LocalPlayerSheet.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val model = vm.model(ui)
    LaunchedEffect(vm) { if (vm.ui.value.phase == SheetPhase.Loading) vm.load() }
    LaunchedEffect(model?.lines) { model?.let { sheet.parentRefreshed(it.lines.map { line -> line.player }) } }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            uri?.let {
                scope.launch {
                    val (bytes, name) = withContext(Dispatchers.IO) { readPicked(context, it) to nameOf(context, it) }
                    vm.chose(bytes, name)
                }
            }
        }
    val ready = ui.export as? SheetExport.Ready
    LaunchedEffect(ready) {
        ready?.let {
            share(context, it.file)
            vm.finishExport()
        }
    }
    SheetScreen(
        view = SheetView(ui, model, ui.formatLabel, ui.stampWords(graph.zone)),
        refreshing = refreshing && ui.phase == SheetPhase.Ready,
        actions =
            SheetActions(
                row =
                    SheetRowActions(
                        open = sheet::open,
                        toggle = vm::toggle,
                        note = { id, text -> vm.setNote(id, text) },
                        tag = vm::toggleTag,
                        addTag = vm::addTag,
                        remove = { vm.remove(it) },
                        retry = { vm.retry() },
                    ),
                panels =
                    SheetPanelActions(
                        start = { vm.start() },
                        openImport = vm::openImport,
                        closeImport = vm::closeImport,
                        chooseFile = { picker.launch(PICKED_TYPES) },
                        paste = vm::paste,
                        importText = { vm.importText(it) },
                    ),
                choose = vm::choose,
                export = { vm.exportFile() },
                refresh = { vm.load() },
                openMock = openMock,
            ),
    )
}

/** A picked file's bytes, one past the import's limit at most (so a larger file is refused as one); a file
 * that cannot be read is said as one that is not text. */
private fun readPicked(
    context: Context,
    uri: Uri,
): ByteArray =
    try {
        context.contentResolver.openInputStream(uri)?.use { readAtMost(it, SheetLimits.CSV_BYTES + 1) } ?: UNREADABLE
    } catch (e: IOException) {
        Log.w(TAG, "read a picked sheet", e)
        UNREADABLE
    } catch (e: SecurityException) {
        Log.w(TAG, "read a picked sheet", e)
        UNREADABLE
    }

/** The picked file's name as the phone's files show it, else the last part of its address. */
private fun nameOf(
    context: Context,
    uri: Uri,
): String {
    val shown =
        try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "name a picked sheet", e)
            null
        }
    return shown ?: uri.lastPathSegment.orEmpty()
}

private fun readAtMost(
    stream: InputStream,
    limit: Int,
): ByteArray {
    val buffer = ByteArray(limit)
    var read = 0
    while (read < limit) {
        val count = stream.read(buffer, read, limit - read)
        if (count < 0) break
        read += count
    }
    return buffer.copyOf(read)
}

/** The export's file handed to the share sheet, read through the app's file provider. */
private fun share(
    context: Context,
    file: File,
) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}$EXPORTS_AUTHORITY", file)
    val send =
        Intent(Intent.ACTION_SEND)
            .setType(CSV_TYPE)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    try {
        context.startActivity(Intent.createChooser(send, file.name))
    } catch (e: ActivityNotFoundException) {
        Log.w(TAG, "share a sheet", e)
    }
}

/** The file provider's authority after the package name (AndroidManifest.xml). */
const val EXPORTS_AUTHORITY = ".exports"
