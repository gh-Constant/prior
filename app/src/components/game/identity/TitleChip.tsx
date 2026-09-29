// A player's equipped title ("Unbreakable", "The Planner") styled by rarity.
import type { EffectsIntensity, Rarity } from "../../../lib/gamification/types";
import { cx, identityClass, useIdentityFx, useIdentityTone, type IdentityTone } from "./tone";
import "./TitleChip.css";

export type TitleChipProps = {
  readonly title: string;
  readonly rarity?: Rarity;
  readonly size?: "sm" | "md";
  readonly tone?: IdentityTone;
  readonly intensity?: EffectsIntensity;
  readonly className?: string;
};

export function TitleChip({ title, rarity = "common", size = "md", tone, intensity, className }: TitleChipProps) {
  const resolvedTone = useIdentityTone(tone);
  const fx = useIdentityFx(intensity);
  return (
    <span className={cx("gi-tc", `gi-tc--${rarity}`, `gi-tc--${size}`, identityClass(resolvedTone, fx), className)} data-rarity={rarity}>
      {(rarity === "epic" || rarity === "legendary") && <i className="gi-tc-orn" aria-hidden="true" />}
      <span className="gi-tc-text">{title}</span>
      {(rarity === "epic" || rarity === "legendary") && <i className="gi-tc-orn" aria-hidden="true" />}
    </span>
  );
}
