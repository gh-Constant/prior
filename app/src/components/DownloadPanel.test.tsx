import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { DownloadPanel } from "./DownloadPanel";

afterEach(() => cleanup());

const RELEASE = {
  assets: [
    { name: "Prior_9.9.9_universal.dmg", browser_download_url: "https://dl/mac.dmg" },
    { name: "Prior_9.9.9_x64-setup.exe", browser_download_url: "https://dl/win.exe" },
    { name: "app-universal-release.apk", browser_download_url: "https://dl/app.apk" },
    { name: "Prior_9.9.9_amd64.AppImage", browser_download_url: "https://dl/linux.AppImage" },
  ],
};

describe("DownloadPanel", () => {
  it("resolves release assets into platform links", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => RELEASE }));
    vi.stubGlobal("fetch", fetchMock);

    render(<DownloadPanel />);
    await waitFor(() => {
      expect(screen.getByText("macOS").closest("a")).toHaveProperty("href", "https://dl/mac.dmg");
    });
    expect(screen.getByText("Windows").closest("a")).toHaveProperty("href", "https://dl/win.exe");
    expect(screen.getByText("Android").closest("a")).toHaveProperty("href", "https://dl/app.apk");

    vi.unstubAllGlobals();
  });

  it("falls back to static links when the lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<DownloadPanel />);
    await waitFor(() => {
      expect(screen.getByText("macOS").closest("a")?.getAttribute("href")).toContain("github.com");
    });
    vi.unstubAllGlobals();
  });
});
