package app.trycommish.android

import android.app.Application

/** Holds the app's one graph for the process, made when first used; at start the push channel is made
 * (Lane 288). */
class CommishApplication : Application() {
    val graph: AppGraph by lazy { AppGraph(this) }

    override fun onCreate() {
        super.onCreate()
        PushChannel.create(this)
    }
}
