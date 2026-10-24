package app.trycommish.core

import java.time.Instant

/** The one source of now. Every time-dependent function takes it, so a test draws a screen at a fixed
 * instant and the app at the device's. */
fun interface Clock {
    fun now(): Instant
}

/** The device's clock. */
object SystemClock : Clock {
    override fun now(): Instant = Instant.now()
}

/** A clock stopped at one instant, for tests and snapshots. */
class FixedClock(
    private val instant: Instant,
) : Clock {
    override fun now(): Instant = instant
}
