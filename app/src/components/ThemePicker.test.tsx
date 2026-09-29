import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "../test/memoryStorage";
import { IdentityToneProvider, useIdentityTone } from "./game/identity/tone";
import { ThemePicker } from "./ThemePicker";

describe("ThemePicker", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.theme;
  });

  it("offers System, Light and Dark as one radio group and applies the choice", () => {
    render(<ThemePicker />);
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(localStorage.getItem("prior.theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(localStorage.getItem("prior.theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("identity tone", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("follows the app theme unless a surface or a prop sets it", () => {
    localStorage.setItem("prior.theme", "dark");
    expect(renderHook(() => useIdentityTone()).result.current).toBe("dark");
    expect(renderHook(() => useIdentityTone("light")).result.current).toBe("light");

    const onLight = ({ children }: { readonly children: ReactNode }) => <IdentityToneProvider tone="light">{children}</IdentityToneProvider>;
    expect(renderHook(() => useIdentityTone(), { wrapper: onLight }).result.current).toBe("light");

    localStorage.setItem("prior.theme", "light");
    const onRail = ({ children }: { readonly children: ReactNode }) => <IdentityToneProvider tone="dark">{children}</IdentityToneProvider>;
    expect(renderHook(() => useIdentityTone(), { wrapper: onRail }).result.current).toBe("dark");
    expect(renderHook(() => useIdentityTone()).result.current).toBe("light");
  });
});
