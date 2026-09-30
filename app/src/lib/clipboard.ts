/**
 * Copies text from a click handler. Safari/WebKit (macOS and the desktop
 * app) forget the click once an `await` has passed, so a value that is still
 * being fetched is handed to the clipboard as a promise (ClipboardItem), which
 * keeps the gesture. Falls back to a hidden textarea where the async
 * clipboard API is missing.
 */
export async function copyText(text: string | Promise<string>): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (typeof text !== "string" && clipboard?.write && typeof ClipboardItem !== "undefined") {
    await clipboard.write([new ClipboardItem({ "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })) })]);
    return;
  }
  const value = await text;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value);
      return;
    } catch (error) {
      if (!legacyCopy(value)) throw error;
      return;
    }
  }
  if (!legacyCopy(value)) throw new Error("Copy is not available here.");
}

function legacyCopy(value: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
