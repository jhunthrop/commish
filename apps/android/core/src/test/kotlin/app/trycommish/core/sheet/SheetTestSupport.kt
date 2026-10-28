package app.trycommish.core.sheet

import app.trycommish.api.models.BoardFormat
import app.trycommish.core.FixedClock
import app.trycommish.core.MemoryCache
import app.trycommish.core.SessionEnd
import app.trycommish.core.board.RunFixture
import app.trycommish.core.board.StubRunReads
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import java.io.File
import java.nio.file.Files
import java.time.ZoneId

/** The member's zone the iOS tests draw in. */
val SHEET_ZONE: ZoneId = ZoneId.of("America/Chicago")

/** A sign-out counter. */
class Ends : SessionEnd {
    var count = 0

    override fun signedOut() {
        count++
    }
}

/** The view model over a stub account at the fixture's clock, in PPR, our board the stand-in's. */
fun sheetViewModel(
    stub: SheetStub,
    io: CoroutineDispatcher,
    cache: MemoryCache = MemoryCache(),
    format: BoardFormat = BoardFormat.ppr,
    ends: SessionEnd = Ends(),
    exports: File = Files.createTempDirectory("sheet-exports").toFile(),
): SheetViewModel =
    SheetViewModel(
        SheetDeps(
            reads = stub,
            run = StubRunReads(RunFixture.StandIn),
            cache = cache,
            clock = FixedClock(SheetClock.now),
            zone = SHEET_ZONE,
            exports = exports,
            io = io,
        ),
        format,
        ends,
    )

/** Runs a verb's work to its end. */
fun TestScope.settle() = advanceUntilIdle()
