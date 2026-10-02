// A share link's secret is stored hashed on the server and returned once, when
// it is created. The device that created it keeps the URL here so the owner can
// copy it again later; other devices (or a cleared browser) regenerate instead.

const STORAGE_KEY = "prior.shareLinks";

function read(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function write(urls: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(urls));
  } catch {
    // Storage blocked: the owner regenerates the link when needed.
  }
}

export function rememberShareLink(linkId: string, url: string): void {
  write({ ...read(), [linkId]: url });
}

export function rememberedShareLink(linkId: string): string | undefined {
  const url = read()[linkId];
  return typeof url === "string" && url ? url : undefined;
}

/** Forgets the URLs of links that no longer exist (rotated or disabled). */
export function pruneShareLinks(activeIds: readonly string[]): void {
  const urls = read();
  const kept = Object.fromEntries(Object.entries(urls).filter(([id]) => activeIds.includes(id)));
  if (Object.keys(kept).length !== Object.keys(urls).length) write(kept);
}
