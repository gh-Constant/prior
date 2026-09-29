import { useId } from "react";
import { useI18n } from "../lib/i18n";
import { setThemePreference, THEME_PREFERENCES, useThemePreference, type ResolvedTheme, type ThemePreference } from "../lib/theme";
import "./ThemePicker.css";

/* Literal colors on purpose: each preview depicts its theme whatever the current one. */
const PREVIEW: Record<ResolvedTheme, { canvas: string; rail: string; panel: string; line: string; ink: string; faint: string }> = {
  light: { canvas: "#fafaf9", rail: "#171716", panel: "#ffffff", line: "#e4e2dd", ink: "#3f3d39", faint: "#d6d4cf" },
  dark: { canvas: "#191715", rail: "#0f0e0c", panel: "#24221f", line: "#35332f", ink: "#d3d1cd", faint: "#4d4b48" },
};

function Scene({ theme, clip }: { readonly theme: ResolvedTheme; readonly clip?: string }) {
  const c = PREVIEW[theme];
  return (
    <g clipPath={clip}>
      <rect width="72" height="46" fill={c.canvas} />
      <rect width="15" height="46" fill={c.rail} />
      <rect x="4" y="6" width="7" height="2" rx="1" fill="#f35f43" />
      <rect x="4" y="12" width="7" height="1.6" rx=".8" fill="#ffffff" opacity=".28" />
      <rect x="4" y="16" width="6" height="1.6" rx=".8" fill="#ffffff" opacity=".18" />
      <rect x="21" y="7" width="22" height="3" rx="1.5" fill={c.ink} />
      <rect x="21" y="15" width="45" height="25" rx="3" fill={c.panel} stroke={c.line} strokeWidth=".8" />
      <circle cx="26" cy="21" r="1.8" fill="none" stroke="#f35f43" strokeWidth=".9" />
      <rect x="30" y="20" width="22" height="2" rx="1" fill={c.ink} opacity=".8" />
      <circle cx="26" cy="28" r="1.8" fill="none" stroke={c.faint} strokeWidth=".9" />
      <rect x="30" y="27" width="28" height="2" rx="1" fill={c.faint} />
      <circle cx="26" cy="35" r="1.8" fill="none" stroke={c.faint} strokeWidth=".9" />
      <rect x="30" y="34" width="18" height="2" rx="1" fill={c.faint} />
    </g>
  );
}

function ThemePreview({ preference }: { readonly preference: ThemePreference }) {
  const clipId = useId().replace(/:/g, "");
  return (
    <svg className="theme-picker-preview" viewBox="0 0 72 46" aria-hidden="true">
      {preference === "system" ? (
        <>
          <defs>
            <clipPath id={`${clipId}-dark`}><path d="M44 0H72V46H26Z" /></clipPath>
          </defs>
          <Scene theme="light" />
          <Scene theme="dark" clip={`url(#${clipId}-dark)`} />
        </>
      ) : (
        <Scene theme={preference} />
      )}
    </svg>
  );
}

/** Light / Dark / System choice with small previews. A native radio group, so arrows and Tab work. */
export function ThemePicker() {
  const { t } = useI18n();
  const preference = useThemePreference();
  const name = useId();
  return (
    <div className="theme-picker" role="radiogroup" aria-label={t("settings.appearance.theme")}>
      {THEME_PREFERENCES.map((option) => (
        <label key={option} className={`theme-picker-option ${preference === option ? "is-selected" : ""}`}>
          <input
            type="radio"
            name={name}
            value={option}
            checked={preference === option}
            onChange={() => setThemePreference(option)}
          />
          <ThemePreview preference={option} />
          <span className="theme-picker-label">{t(`settings.appearance.${option}`)}</span>
        </label>
      ))}
    </div>
  );
}
