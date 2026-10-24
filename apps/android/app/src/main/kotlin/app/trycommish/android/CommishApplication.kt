package app.trycommish.android

import android.app.Application

/** Holds the app's one graph for the process. */
class CommishApplication : Application() {
    val graph: AppGraph by lazy { AppGraph(this) }
}
