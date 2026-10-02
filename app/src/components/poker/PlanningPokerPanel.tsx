import { useMemo, useState } from "react";
import { useOnline } from "../../lib/connectivity";
import { useI18n } from "../../lib/i18n";
import { useSoloPoker, type PokerCycleLike, type PokerTaskLike } from "../../lib/poker";
import { ProjectShareDialog } from "../collaboration/ProjectShareDialog";
import type { ProjectSharingProps } from "../collaboration/types";
import { PokerRoom } from "./PokerRoom";
import { useSharedPoker } from "./useSharedPoker";
import "./Poker.css";

export type PokerPerson = { readonly id: string; readonly name: string; readonly avatarUrl?: string | null };

export type PlanningPokerPanelProps = {
  readonly projectId: string;
  readonly projectName: string;
  /** The project lives on the server (members, realtime). Otherwise the table is solo. */
  readonly shared: boolean;
  /** Viewers watch; owners and editors play. */
  readonly role?: "owner" | "editor" | "viewer";
  readonly currentUser: PokerPerson | null;
  readonly tasks: ReadonlyArray<PokerTaskLike & { title: string }>;
  readonly cycles: readonly PokerCycleLike[];
  /** Solo mode: saves the accepted estimate on the task (shared tables save through the API). */
  readonly onSetPoints: (taskId: string, points: number | null) => Promise<void>;
  /** The sharing actions of the project, to offer "Share" from a solo table. */
  readonly sharing?: ProjectSharingProps;
  /** Overrides "today" (YYYY-MM-DD) for picking the active sprint; for tests. */
  readonly today?: string;
};

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

type HostProps = PlanningPokerPanelProps & { readonly today: string; readonly onShare?: () => void; readonly dialogOpen: boolean };

function SharedHost({ projectId, role, currentUser, tasks, cycles, today, dialogOpen }: HostProps) {
  const online = useOnline();
  const controller = useSharedPoker(projectId, currentUser?.id ?? null);
  return <PokerRoom controller={controller} meId={currentUser?.id ?? null} solo={false} canPlay={role !== "viewer"} offline={!online} tasks={tasks} cycles={cycles} today={today} keysEnabled={!dialogOpen} />;
}

function SoloHost({ projectId, currentUser, tasks, cycles, role, today, onSetPoints, onShare, dialogOpen }: HostProps) {
  const { t } = useI18n();
  const me = useMemo(() => ({ id: currentUser?.id ?? "me", name: currentUser?.name || t("poker.solo.you"), avatarUrl: currentUser?.avatarUrl ?? null }), [currentUser?.id, currentUser?.name, currentUser?.avatarUrl, t]);
  const controller = useSoloPoker({ projectId, me, tasks, onSetPoints });
  return <PokerRoom controller={controller} meId={me.id} solo canPlay={role !== "viewer"} offline={false} tasks={tasks} cycles={cycles} today={today} onShare={onShare} keysEnabled={!dialogOpen} />;
}

/**
 * The Planning Poker tab of a Scrum or Scrumban project: a shared table for
 * projects with members, a solo table (same screen, same cards) for the rest.
 */
export function PlanningPokerPanel(props: PlanningPokerPanelProps) {
  const { t } = useI18n();
  const [shareOpen, setShareOpen] = useState(false);
  const today = props.today ?? localToday();
  const host: HostProps = { ...props, today, onShare: props.sharing ? () => setShareOpen(true) : undefined, dialogOpen: shareOpen };
  return (
    <section className="poker-panel" aria-label={t("poker.panel.label", { name: props.projectName })}>
      {props.shared ? <SharedHost {...host} /> : <SoloHost {...host} />}
      {shareOpen && props.sharing && <ProjectShareDialog {...props.sharing} projectName={props.projectName} onClose={() => setShareOpen(false)} />}
    </section>
  );
}
