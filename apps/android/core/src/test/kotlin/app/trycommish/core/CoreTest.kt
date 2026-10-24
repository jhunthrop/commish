package app.trycommish.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.time.Instant
import java.time.ZoneId

class CoreTest {
    @Test
    fun `the file cache keeps an answer with its stamp across instances`(
        @TempDir dir: File,
    ) {
        val stamp = Instant.parse("2026-10-18T18:56:00Z")
        FileCache(dir).write("/leagues/attached/x/sync", Cached("{\"ok\":true}\nsecond line", stamp))
        assertEquals(Cached("{\"ok\":true}\nsecond line", stamp), FileCache(dir).read("/leagues/attached/x/sync"))
        assertNull(FileCache(dir).read("/leagues/attached/y/sync"))
    }

    @Test
    fun `a damaged cache file is a miss, never a crash`(
        @TempDir dir: File,
    ) {
        val cache = FileCache(dir)
        cache.write("k", Cached("body", Instant.EPOCH))
        requireNotNull(dir.listFiles()).single().writeText("not a stamp\nbody")
        assertNull(cache.read("k"))
    }

    @Test
    fun `numbers and times print as the web prints them`() {
        assertEquals(
            listOf("1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "112th"),
            listOf(1, 2, 3, 4, 11, 12, 13, 21, 112).map(Format::ordinal),
        )
        assertEquals("1,000", Format.count(1000))
        assertEquals("567.0", Format.fixed(567.0))
        assertEquals("Sun 1:05 pm", Format.weekdayTime(Instant.parse("2026-10-18T18:05:00Z"), ZoneId.of("America/Chicago")))
        assertEquals("1 player", Format.plural(1, "player", "players"))
    }

    @Test
    fun `a fixed clock reads the same instant every time`() {
        val clock = FixedClock(Instant.EPOCH)
        assertEquals(clock.now(), clock.now())
    }
}
