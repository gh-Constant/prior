package fr.constantsuchet.prior

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
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
class WidgetSnapshotArgs {
    lateinit var snapshotJson: String
}

data class SessionResult(val token: String?)

data class GoogleSignInResult(val idToken: String?)

data class PlayUpdateResult(val available: Boolean, val versionCode: Int)

private const val PLAY_UPDATE_REQUEST_CODE = 7311

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
    fun setWidgetSnapshot(invoke: Invoke) {
        runCatching {
            val json = invoke.parseArgs(WidgetSnapshotArgs::class.java).snapshotJson
            PriorWidgetStore.setSnapshot(activity, json)
            scope.launch { PriorWidgetStore.updateAll(activity.applicationContext) }
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

    // Play In-App Updates. Rejects when the app was not installed from Google
    // Play (sideloaded APK, debug build) so the frontend can fall back to the
    // GitHub release flow.
    @Command
    fun playUpdateCheck(invoke: Invoke) {
        AppUpdateManagerFactory.create(activity).appUpdateInfo
            .addOnSuccessListener { info ->
                val available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE &&
                    info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)
                invoke.resolveObject(PlayUpdateResult(available, info.availableVersionCode()))
            }
            .addOnFailureListener { error -> invoke.reject(error.message ?: "Play update check failed") }
    }

    // Starts Play's full-screen immediate update; Play restarts the app when done.
    @Command
    fun playUpdateStart(invoke: Invoke) {
        val manager = AppUpdateManagerFactory.create(activity)
        manager.appUpdateInfo
            .addOnSuccessListener { info ->
                if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE &&
                    info.updateAvailability() != UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
                ) {
                    invoke.reject("No Play update available")
                    return@addOnSuccessListener
                }
                runCatching {
                    manager.startUpdateFlowForResult(
                        info,
                        activity,
                        AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(),
                        PLAY_UPDATE_REQUEST_CODE,
                    )
                    invoke.resolve()
                }.onFailure { error -> invoke.reject(error.message) }
            }
            .addOnFailureListener { error -> invoke.reject(error.message ?: "Play update failed") }
    }

    override fun onDestroy(activity: androidx.appcompat.app.AppCompatActivity) {
        scope.cancel()
        super.onDestroy(activity)
    }
}
