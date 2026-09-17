package fr.constantsuchet.prior

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.glance.appwidget.updateAll
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
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

data class GoogleSignInResult(val idToken: String?)

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

    // Native Google sign-in via the system account picker (Credential Manager).
    // Resolves with the Google ID token, with a null token when the user
    // dismisses the picker. Anything else rejects so the frontend can fall
    // back to the browser OAuth flow.
    @Command
    fun googleSignIn(invoke: Invoke) {
        scope.launch {
            try {
                val googleIdOption = GetGoogleIdOption.Builder()
                    .setFilterByAuthorizedAccounts(false)
                    .setAutoSelectEnabled(false)
                    .apply {
                        val serverClientId = BuildConfig.GOOGLE_SERVER_CLIENT_ID
                        if (serverClientId.isNotEmpty()) setServerClientId(serverClientId)
                    }
                    .build()
                val request = GetCredentialRequest.Builder()
                    .addCredentialOption(googleIdOption)
                    .build()
                val credentialManager = CredentialManager.create(activity)
                val result = credentialManager.getCredential(activity, request)
                val googleCredential = GoogleIdTokenCredential.createFrom(result.credential.data)
                invoke.resolveObject(GoogleSignInResult(googleCredential.idToken))
            } catch (cancelled: GetCredentialCancellationException) {
                invoke.resolveObject(GoogleSignInResult(null))
            } catch (error: Exception) {
                invoke.reject(error.message)
            }
        }
    }

    override fun onDestroy(activity: androidx.appcompat.app.AppCompatActivity) {
        scope.cancel()
        super.onDestroy(activity)
    }
}
