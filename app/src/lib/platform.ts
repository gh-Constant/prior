function hasTauriInternals(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function currentUserAgent(): string {
  if (typeof navigator === "undefined" || typeof navigator.userAgent !== "string") return "";
  return navigator.userAgent;
}

/** True inside any Tauri shell (desktop or mobile). */
export function isTauri(): boolean {
  return hasTauriInternals();
}

/** True inside the Android Tauri shell. */
export function isAndroid(): boolean {
  return hasTauriInternals() && currentUserAgent().toLowerCase().includes("android");
}

/** True on iOS Tauri shells (kept separate from Android checks). */
export function isIos(): boolean {
  if (!hasTauriInternals()) return false;
  return /iphone|ipad|ipod/i.test(currentUserAgent());
}

/** True for any mobile Tauri shell (Android or iOS). */
export function isMobileTauri(): boolean {
  if (!hasTauriInternals()) return false;
  return /android|iphone|ipad|ipod/i.test(currentUserAgent());
}

/** True for desktop Tauri shells (macOS / Windows / Linux). */
export function isDesktop(): boolean {
  return hasTauriInternals() && !/android|iphone|ipad|ipod/i.test(currentUserAgent());
}

/** Whether the native realtime websocket is available. Web builds use polling. */
export function supportsRealtime(): boolean {
  return hasTauriInternals();
}

/** Whether the local Codex CLI integration is available (desktop only). */
export function supportsCodex(): boolean {
  return isDesktop();
}

/** Desktop updater (Tauri updater plugin) support. */
export function supportsDesktopUpdates(): boolean {
  return isDesktop();
}

/** Android sideloaded-APK update support. */
export function supportsAndroidUpdates(): boolean {
  return isAndroid();
}
