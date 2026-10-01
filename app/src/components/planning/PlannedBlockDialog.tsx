import type { Task } from "../../types";
import { useI18n } from "../../lib/i18n";
import { pinBlock, postponeTask, unpinTask } from "../../lib/planning";
import { formatEstimate } from "../../lib/taskEstimate";
import { dateKeyOf, minutesToClock, type PlannedBlock, type PlanningSettings, type TaskEstimate } from "../../lib/timeBlocking";
import { Icon } from "../Icon";
import { Modal } from "../Modal";
import { PlanningSettingsPanel } from "./PlanningSettingsPanel";
import "./Planning.css";

type Props = {
  readonly block: PlannedBlock;
  readonly task: Task;
  readonly estimate?: TaskEstimate;
  readonly settings: PlanningSettings;
  readonly now: Date;
  readonly onClose: () => void;
  readonly onTaskChange: (task: Task) => Promise<void>;
  readonly onTaskEdit: (task: Task) => void;
  readonly onOpenSettings: () => void;
};

function clockLabel(minutes: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }).format(new Date(`2020-01-01T${minutesToClock(Math.min(minutes, 24 * 60 - 1))}`));
}

/** What a planned block is and what can be done with it. */
export function PlannedBlockDialog({ block, task, estimate, settings, now, onClose, onTaskChange, onTaskEdit, onOpenSettings }: Props) {
  const { t, lang } = useI18n();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const today = dateKeyOf(now);
  const inProgress = block.date === today && block.start <= nowMinutes && nowMinutes < block.end;
  const pinned = Boolean(task.scheduledTime && task.scheduledDate);
  const day = new Intl.DateTimeFormat(lang, { dateStyle: "full" }).format(new Date(`${block.date}T00:00:00`));
  const duration = formatEstimate(estimate?.minutes) ?? "";
  const estimateLine = estimate ? t(estimate.source === "user" ? "planning.block.estimateUser" : estimate.source === "ai" ? "planning.block.estimateAi" : "planning.block.estimateGuess", { duration }) : null;
  const act = (next: Task) => { void onTaskChange(next); onClose(); };

  return (
    <Modal title={task.title} onClose={onClose} className="calendar-editor-modal">
      <div className="calendar-editor-form planning-detail">
        <p className="calendar-detail-meta"><Icon name="clock" aria-hidden="true" /><span>{day.charAt(0).toLocaleUpperCase(lang) + day.slice(1)} · {clockLabel(block.start, lang)} – {clockLabel(block.end, lang)}</span></p>
        <div className="planning-detail-tags">
          <span className={`planning-tag ${block.fixed && !inProgress ? "" : "is-accent"}`}><Icon name={block.fixed && pinned ? "lock" : "sparkles"} aria-hidden="true" />{inProgress ? t("planning.block.inProgress") : pinned ? t("planning.block.fixed") : t("planning.block.planned")}</span>
          <span className={`planning-tag ${block.energy === "deep" ? "is-deep" : ""}`}><Icon name={block.energy === "deep" ? "focus" : "zap"} aria-hidden="true" />{block.energy === "deep" ? t("planning.block.deep") : t("planning.block.light")}</span>
          {block.parts > 1 && <span className="planning-tag">{t("planning.block.part", { part: block.part, parts: block.parts })}</span>}
          {block.late && <span className="planning-tag is-danger"><Icon name="flag" aria-hidden="true" />{t("planning.block.late")}</span>}
        </div>
        {estimateLine && <small>{estimateLine}</small>}
        <div className="planning-detail-actions">
          <button type="button" className="primary-button" onClick={() => act({ ...task, completed: true })}><Icon name="check" />{t("planning.block.complete")}</button>
          <button type="button" className="secondary-button" onClick={() => { onClose(); onTaskEdit(task); }}><Icon name="pencil" />{t("planning.block.open")}</button>
          {pinned
            ? <button type="button" className="secondary-button" onClick={() => act(unpinTask(task))}><Icon name="sparkles" />{t("planning.block.unpin")}</button>
            : <button type="button" className="secondary-button" title={t("planning.block.pinHint")} onClick={() => act(pinBlock(task, block, estimate?.minutes ?? block.end - block.start))}><Icon name="lock" />{t("planning.block.pin")}</button>}
          <button type="button" className="secondary-button" onClick={() => act(postponeTask(task, today, settings))}><Icon name="later" />{t("planning.block.notToday")}</button>
        </div>
        <button type="button" className="secondary-button" onClick={() => { onClose(); onOpenSettings(); }}><Icon name="sliders" />{t("planning.block.settings")}</button>
      </div>
    </Modal>
  );
}

export function PlanningSettingsDialog({ onClose }: { readonly onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal title={t("planning.settings.tab")} onClose={onClose} className="planning-settings-modal">
      <div className="settings-panel planning-settings-dialog"><PlanningSettingsPanel /></div>
    </Modal>
  );
}
