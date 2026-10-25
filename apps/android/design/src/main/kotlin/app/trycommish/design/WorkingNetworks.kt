package app.trycommish.design

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/** The device's networks as a face's retry needs them: `watch` calls `onWorking` each time a network
 * becomes able to reach the internet after the watch began, and returns how to stop watching. */
fun interface WorkingNetworks {
    fun watch(onWorking: () -> Unit): () -> Unit
}

/** One event per network gained while collected; registered when collection starts and unregistered
 * when it stops, so a watch lives exactly as long as the face that waits on it. */
fun WorkingNetworks.gained(): Flow<Unit> =
    callbackFlow {
        val stop = watch { trySend(Unit) }
        awaitClose(stop)
    }

/**
 * Which network counts as newly working: one that reaches VALIDATED (an address resolves and the
 * internet answers) and is not the one already working when the watch began or last reported, so the
 * callback's first report of the current network is no event and a face that fails online does not
 * retry in a loop. A lost network clears, so its return counts again.
 */
class WorkingNetwork<N : Any>(
    current: N?,
) {
    private var working: N? = current

    fun changed(
        network: N,
        validated: Boolean,
    ): Boolean {
        if (!validated || network == working) return false
        working = network
        return true
    }

    fun lost(network: N) {
        if (network == working) working = null
    }
}

/** The platform's default network through ConnectivityManager. */
class DeviceNetworks(
    context: Context,
) : WorkingNetworks {
    private val manager = context.applicationContext.getSystemService(ConnectivityManager::class.java)

    override fun watch(onWorking: () -> Unit): () -> Unit {
        val manager = manager ?: return {}
        val current = manager.activeNetwork?.takeIf { validated(manager.getNetworkCapabilities(it)) }
        val state = WorkingNetwork(current)
        val callback =
            object : ConnectivityManager.NetworkCallback() {
                override fun onCapabilitiesChanged(
                    network: Network,
                    capabilities: NetworkCapabilities,
                ) {
                    if (state.changed(network, validated(capabilities))) onWorking()
                }

                override fun onLost(network: Network) = state.lost(network)
            }
        manager.registerDefaultNetworkCallback(callback)
        return { manager.unregisterNetworkCallback(callback) }
    }

    private fun validated(capabilities: NetworkCapabilities?): Boolean =
        capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
}
