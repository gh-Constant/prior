import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DesktopTitleBar } from "./DesktopTitleBar";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

function setShell(tauri: boolean, ua: string) {
  if (tauri) vi.stubGlobal("__TAURI_INTERNALS__", {});
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: ua });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DesktopTitleBar", () => {
  it("renders nothing outside Tauri shells", () => {
    setShell(false, MAC_UA);
    const { container } = render(<DesktopTitleBar />);
    expect(container.querySelector(".window-dragbar")).toBeNull();
  });

  it("shows a bare drag strip on macOS (traffic lights stay native)", () => {
    setShell(true, MAC_UA);
    const { container } = render(<DesktopTitleBar />);
    expect(container.querySelector(".window-dragbar")).not.toBeNull();
    expect(container.querySelector(".window-caption")).toBeNull();
  });

  it("incrusts caption buttons on other desktops", () => {
    setShell(true, WINDOWS_UA);
    const { container } = render(<DesktopTitleBar />);
    expect(container.querySelector(".window-dragbar")).not.toBeNull();
    expect(container.querySelectorAll(".window-caption-btn")).toHaveLength(3);
  });
});
