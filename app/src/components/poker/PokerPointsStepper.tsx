import { Icon } from "../Icon";
import { useI18n } from "../../lib/i18n";
import { formatStoryPointsValue } from "../../lib/storyPoints";

/**
 * Picks the estimate to accept by stepping through the deck's values. This is
 * a poker-local stand-in: the app-wide picker is `StoryPointsPicker` in
 * components/tasks/StoryPoints.tsx, and this can be replaced by it once that
 * lands (same `value` / `onChange` contract, plus the `options` of the deck).
 */
export function PokerPointsStepper({ value, options, onChange, disabled }: {
  readonly value: number | null;
  readonly options: readonly number[];
  readonly onChange: (value: number) => void;
  readonly disabled?: boolean;
}) {
  const { t } = useI18n();
  const lower = value === null ? undefined : [...options].reverse().find((option) => option < value);
  const higher = value === null ? options[0] : options.find((option) => option > value);
  return (
    <div className="poker-stepper" role="group" aria-label={t("poker.controls.estimate")}>
      <button type="button" className="poker-stepper-button" aria-label={t("poker.controls.lower")} disabled={disabled || lower === undefined} onClick={() => lower !== undefined && onChange(lower)}><Icon name="chevron-left" aria-hidden="true" /></button>
      <output className="poker-stepper-value" aria-live="polite">{value === null ? "–" : formatStoryPointsValue(value)}</output>
      <button type="button" className="poker-stepper-button" aria-label={t("poker.controls.higher")} disabled={disabled || higher === undefined} onClick={() => higher !== undefined && onChange(higher)}><Icon name="chevron-right" aria-hidden="true" /></button>
    </div>
  );
}
