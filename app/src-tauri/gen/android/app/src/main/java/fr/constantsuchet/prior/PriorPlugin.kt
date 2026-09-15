package fr.constantsuchet.prior

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@InvokeArg
class SessionTokenArgs {
    lateinit var token: String
}

@InvokeArg
class WidgetItemsArgs {
    var items: List<String> = emptyList()
}

data class SessionResult(val token: String?)

@TauriPlugin
class PriorPlugin(private val activity: Activity) : Plugin(activity) {
    private val sessionStore = PriorSessionStore(activity)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    @Command
    fun get(invoke: Invoke) {
        invoke.resolveObject(SessionResult(sessionStore.get()))
    }

    @Command
    fun set(invoke: Invoke) {
        runCatching {
            sessionStore.put(invoke.parseArgs(SessionTokenArgs::class.java).token)
            invoke.resolve()
        }.onFailure { error -> invoke.reject(error.message) }
    }

    @Command
    fun clear(invoke: Invoke) {
        sessionStore.clear()
        invoke.resolve()
    }

    @Command
    fun setWidgetItems(invoke: Invoke) {
        runCatching {
            val items = invoke.parseArgs(WidgetItemsArgs::class.java).items
            PriorWidgetStore.setItems(activity, items)
            scope.launch { PriorWidget().updateAll(activity.applicationContext) }
            invoke.resolve()
        }.onFailure { error -> invoke.reject(error.message) }
    }

    override fun onDestroy(activity: androidx.appcompat.app.AppCompatActivity) {
        scope.cancel()
        super.onDestroy(activity)
    }
}
