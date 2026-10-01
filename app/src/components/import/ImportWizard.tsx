import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useI18n } from "../../lib/i18n";
import { localStore } from "../../lib/localStore";
import { workspaceStore } from "../../lib/workspaceStore";
import { analyzeFiles, parseAll, type AnalyzedFile, type ParseSettings } from "../../lib/import/analyze";
import { loadAiAccess, organiseWithAi, type AiAccess, type AiProgress } from "../../lib/import/ai";
import { countDuplicates, eligibleTasks, planImport, type AreaChoice, type ExistingTask, type ImportPlan } from "../../lib/import/planImport";
import type { ImportBatch, ImportFile, ImportWarning } from "../../lib/import/types";
import { readImportFiles } from "../../lib/import/zip";
import type { Area } from "../../types";
import type { WorkspaceView } from "../AppSidebar";
import { Icon, type IconName } from "../Icon";
import { PreviewStep } from "./PreviewStep";
import { warningText } from "./warnings";
import "./ImportWizard.css";

export type ImportWizardProps = {
  /** Writes a confirmed plan and reports how many tasks and new projects were created. */
  readonly onImport: (plan: ImportPlan, onProgress?: (done: number, total: number) => void) => Promise<{ tasks: number; projects: number }>;
  readonly onNavigate?: (view: WorkspaceView) => void;
};

type Step = "source" | "preview" | "run";
type SourceChoice = "todoist" | "linear" | "notion" | "other";

const SOURCES: ReadonlyArray<{ readonly id: SourceChoice; readonly icon: IconName }> = [
  { id: "todoist", icon: "check-circle" },
  { id: "linear", icon: "layers" },
  { id: "notion", icon: "file-text" },
  { id: "other", icon: "list" },
];

type Existing = { tasks: ExistingTask[]; projects: string[]; areas: Area[] };

export function ImportWizard({ onImport, onNavigate }: ImportWizardProps) {
  const { t, tp, lang } = useI18n();
  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<SourceChoice>("todoist");
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [pasted, setPasted] = useState("");
  const [readWarnings, setReadWarnings] = useState<ImportWarning[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [access, setAccess] = useState<AiAccess>("checking");
  const [useAi, setUseAi] = useState(false);
  const [organising, setOrganising] = useState<AiProgress | null>(null);
  const cancel = useRef<AbortController | null>(null);
  const [aiNotice, setAiNotice] = useState<"plan" | "quota" | "failed" | null>(null);
  const [aiUsed, setAiUsed] = useState(false);

  const [analyzed, setAnalyzed] = useState<AnalyzedFile[]>([]);
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [area, setArea] = useState<AreaChoice>({ mode: "none" });
  const [existing, setExisting] = useState<Existing>({ tasks: [], projects: [], areas: [] });

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<{ tasks: number; projects: number; skipped: number } | null>(null);

  const settings = useMemo<ParseSettings>(() => ({ order: lang === "en" ? "mdy" : "dmy", lang }), [lang]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void loadAiAccess().then((value) => { if (live) setAccess(value); });
    return () => { live = false; };
  }, []);

  const loadExisting = useCallback(async (): Promise<Existing> => {
    const projects = workspaceStore.listProjects();
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const tasks = (await localStore.listTasks()).filter((task) => !task.deletedAt).map((task) => ({ title: task.title, projectName: task.projectId ? names.get(task.projectId) ?? null : null }));
    return { tasks, projects: projects.map((project) => project.name), areas: workspaceStore.listAreas() };
  }, []);

  async function addFiles(list: readonly File[]) {
    if (list.length === 0) return;
    setError(null);
    try {
      const read = await readImportFiles(list);
      setFiles((current) => [...current, ...read.files]);
      setReadWarnings(read.warnings);
    } catch {
      setError(t("import.source.unreadable"));
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void addFiles([...event.dataTransfer.files]);
  }

  const aiOn = useAi && access === "ready";
  const hasInput = files.length > 0 || pasted.trim() !== "";

  async function buildPreview() {
    setError(null);
    setAiNotice(null);
    setAiUsed(false);
    const inputs: ImportFile[] = [...files, ...(pasted.trim() ? [{ name: "", text: pasted }] : [])];
    const items = analyzeFiles(inputs);
    if (items.length === 0) {
      setError(t("import.source.nothing"));
      return;
    }
    const current = await loadExisting();
    setExisting(current);
    let result: ImportBatch;
    if (aiOn) {
      const controller = new AbortController();
      cancel.current = controller;
      setOrganising({ done: 0, total: 0 });
      try {
        const ai = await organiseWithAi({ files: items, settings, existingProjects: current.projects, onProgress: setOrganising, signal: controller.signal });
        result = ai.batch;
        setAiUsed(ai.requests > 0 && ai.stopped === null);
        if (ai.stopped) setAiNotice(ai.stopped);
      } catch (failure) {
        setOrganising(null);
        cancel.current = null;
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        setAiNotice("failed");
        result = parseAll(items, settings);
      }
      setOrganising(null);
      cancel.current = null;
    } else {
      result = parseAll(items, settings);
    }
    if (result.tasks.length === 0) {
      setError(t("import.source.nothing"));
      return;
    }
    setAnalyzed(items);
    setBatch(result);
    setSelected(new Set(result.tasks.map((task) => task.key)));
    setIncludeCompleted(false);
    setSkipDuplicates(true);
    setArea(result.projects.some((project) => project.areaName) ? { mode: "source" } : { mode: "none" });
    setStep("preview");
  }

  /** A column mapping changed: read the same files again (without AI). */
  function remap(items: AnalyzedFile[]) {
    setAnalyzed(items);
    const next = parseAll(items, settings);
    setBatch(next);
    setSelected(new Set(next.tasks.map((task) => task.key)));
  }

  const plan = useMemo(
    () => (batch ? planImport(batch, { selected, includeCompleted, skipDuplicates, area }, existing.tasks) : null),
    [batch, selected, includeCompleted, skipDuplicates, area, existing.tasks],
  );
  const duplicates = useMemo(() => (batch ? countDuplicates(eligibleTasks(batch, { selected, includeCompleted }), existing.tasks) : 0), [batch, selected, includeCompleted, existing.tasks]);

  async function runImport() {
    if (!plan || plan.tasks.length === 0) return;
    setError(null);
    setProgress({ done: 0, total: plan.tasks.length });
    setOutcome(null);
    setStep("run");
    try {
      const done = await onImport(plan, (count, total) => setProgress({ done: count, total }));
      setOutcome({ ...done, skipped: plan.skippedDuplicates });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("import.run.failedGeneric"));
    }
  }

  function startOver() {
    setStep("source");
    setFiles([]);
    setPasted("");
    setBatch(null);
    setAnalyzed([]);
    setReadWarnings([]);
    setOutcome(null);
    setProgress(null);
    setError(null);
    setAiNotice(null);
  }

  const stepIndex = step === "source" ? 0 : step === "preview" ? 1 : 2;
  const stepNames = [t("import.steps.source"), t("import.steps.preview"), t("import.steps.import")];

  return (
    <div className="imp">
      <header className="imp-head">
        <h2>{t("import.title")}</h2>
        <p>{t("import.subtitle")}</p>
      </header>
      <ol className="imp-steps" aria-label={t("import.stepsLabel")}>
        {stepNames.map((name, index) => (
          <li key={name} className={index === stepIndex ? "is-current" : index < stepIndex ? "is-done" : ""} aria-current={index === stepIndex ? "step" : undefined}>
            <span className="imp-step-num" aria-hidden="true">{index < stepIndex ? <Icon name="check" /> : index + 1}</span>
            <span className="imp-step-name">{name}</span>
          </li>
        ))}
      </ol>

      {step === "source" && (
        <section className="imp-card" aria-labelledby="imp-source-title">
          <h3 id="imp-source-title" className="imp-card-title">{t("import.source.title")}</h3>
          <div className="imp-sources" role="radiogroup" aria-label={t("import.source.title")}>
            {SOURCES.map((entry) => (
              <label key={entry.id} className={`imp-source ${source === entry.id ? "is-selected" : ""}`}>
                <input type="radio" name="import-source" value={entry.id} checked={source === entry.id} onChange={() => setSource(entry.id)} />
                <span className="imp-source-icon"><Icon name={entry.icon} /></span>
                <span className="imp-source-name">{t(`import.source.${entry.id}.name`)}</span>
              </label>
            ))}
          </div>
          <div className="imp-how">
            <strong>{t(`import.source.${source}.title`)}</strong>
            <p>{t(`import.source.${source}.how`)}</p>
          </div>

          <label
            className={`imp-drop ${dragging ? "is-over" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".csv,.zip,.txt,.md,text/csv,text/plain,application/zip"
              onChange={(event) => { void addFiles([...(event.target.files ?? [])]); event.target.value = ""; }}
              aria-label={t("import.drop.choose")}
            />
            <Icon name="download" />
            <span className="imp-drop-title">{dragging ? t("import.drop.release") : t("import.drop.title")}</span>
            <span className="imp-drop-hint">{t("import.drop.hint")}</span>
          </label>

          {files.length > 0 && (
            <ul className="imp-files" aria-label={t("import.drop.listLabel")}>
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`}>
                  <Icon name="file" />
                  <span className="imp-file-name">{file.name}</span>
                  <button type="button" className="imp-icon-button" aria-label={t("import.drop.remove", { name: file.name })} onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}><Icon name="close" /></button>
                </li>
              ))}
            </ul>
          )}
          {readWarnings.length > 0 && <ul className="imp-notes">{readWarnings.map((warning, index) => <li key={index}>{warningText(warning, t)}</li>)}</ul>}

          <div className="imp-paste">
            <label htmlFor="imp-paste-input">{t("import.paste.label")}</label>
            <textarea id="imp-paste-input" value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder={t("import.paste.placeholder")} rows={source === "other" ? 7 : 4} spellCheck={false} />
            <span className="imp-hint">{t("import.paste.hint")}</span>
          </div>

          {access !== "checking" && access !== "signed-out" && (
            <div className={`imp-ai ${access === "ready" ? "" : "is-locked"}`}>
              <span className="imp-ai-icon"><Icon name="sparkles" /></span>
              <div className="imp-ai-text">
                <strong>{t("import.ai.title")} <span className="imp-pro">{t("import.ai.badge")}</span></strong>
                <span>{access === "locked" ? t("import.ai.locked") : access === "unavailable" ? t("import.ai.unavailable") : t("import.ai.description")}</span>
              </div>
              {access === "locked" && onNavigate && <button type="button" className="secondary-button" onClick={() => onNavigate("plans")}>{t("import.ai.upgrade")}</button>}
              <button
                type="button"
                role="switch"
                className="settings-switch"
                aria-checked={aiOn}
                aria-label={t("import.ai.title")}
                disabled={access !== "ready" || organising !== null}
                onClick={() => setUseAi((value) => !value)}
              />
            </div>
          )}

          {error && <p className="settings-error" role="alert">{error}</p>}
          <div className="imp-actions">
            {organising ? (
              <>
                <span className="imp-progress-text" role="status">{organising.total > 0 ? t("import.actions.organising", { done: organising.done, total: organising.total }) : t("import.actions.organisingStart")}</span>
                <button type="button" className="secondary-button" onClick={() => cancel.current?.abort()}>{t("import.actions.cancel")}</button>
              </>
            ) : (
              <button type="button" className="primary-button" disabled={!hasInput} onClick={() => void buildPreview()}>{t("import.actions.preview")}</button>
            )}
          </div>
        </section>
      )}

      {step === "preview" && batch && plan && (
        <PreviewStep
          batch={batch}
          analyzed={aiUsed ? [] : analyzed}
          onAnalyzed={remap}
          selected={selected}
          onSelectedChange={setSelected}
          includeCompleted={includeCompleted}
          onIncludeCompletedChange={setIncludeCompleted}
          skipDuplicates={skipDuplicates}
          onSkipDuplicatesChange={setSkipDuplicates}
          area={area}
          onAreaChange={setArea}
          areas={existing.areas}
          duplicates={duplicates}
          plan={plan}
          aiNotice={aiNotice}
          aiUsed={aiUsed}
          sourceName={source === "other" ? "" : t(`import.source.${source}.name`)}
          onBack={() => setStep("source")}
          onImport={() => void runImport()}
          onUpgrade={onNavigate ? () => onNavigate("plans") : undefined}
        />
      )}

      {step === "run" && (
        <section className="imp-card imp-run" aria-live="polite">
          {error ? (
            <>
              <h3 className="imp-card-title">{t("import.run.failedTitle")}</h3>
              <p className="settings-error" role="alert">{error}</p>
              <div className="imp-actions">
                <button type="button" className="secondary-button" onClick={() => setStep("preview")}>{t("import.actions.back")}</button>
                <button type="button" className="primary-button" onClick={() => void runImport()}>{t("import.run.retry")}</button>
              </div>
            </>
          ) : outcome ? (
            <>
              <span className="imp-done-icon" aria-hidden="true"><Icon name="check" /></span>
              <h3 className="imp-card-title">{t("import.run.doneTitle")}</h3>
              <p>{t("import.run.summary", { tasks: tp("import.preview.tasks", outcome.tasks), projects: tp("import.preview.projects", outcome.projects) })}</p>
              {outcome.skipped > 0 && <p className="imp-hint">{tp("import.run.skipped", outcome.skipped)}</p>}
              <div className="imp-actions">
                <button type="button" className="secondary-button" onClick={startOver}>{t("import.run.more")}</button>
                {onNavigate && <button type="button" className="primary-button" onClick={() => onNavigate("all")}>{t("import.run.openTasks")}</button>}
              </div>
            </>
          ) : (
            <>
              <h3 className="imp-card-title">{t("import.run.importing")}</h3>
              <div className="imp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress?.total ?? 0} aria-valuenow={progress?.done ?? 0} aria-label={t("import.run.importing")}>
                <span style={{ width: `${progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
              </div>
              <p className="imp-hint">{t("import.run.progress", { done: progress?.done ?? 0, total: progress?.total ?? 0 })}</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
