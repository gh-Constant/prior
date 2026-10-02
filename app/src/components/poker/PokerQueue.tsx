import { Icon } from "../Icon";
import { useI18n } from "../../lib/i18n";
import type { PokerSession } from "../../lib/api";
import { pointsLabel } from "./pointsLabel";

/** The tasks of the session: a list beside the table, a sideways strip on phones. */
export function PokerQueue({ session, canJump, disabled, onJump }: {
  readonly session: PokerSession;
  readonly canJump: boolean;
  readonly disabled: boolean;
  readonly onJump: (index: number) => void;
}) {
  const { t, tp } = useI18n();
  const decided = session.items.filter((item) => item.finalPoints !== null).length;
  return (
    <nav className="poker-queue" aria-label={t("poker.queue.label")}>
      <h3>{t("poker.queue.title")} <span>{decided}/{session.items.length}</span></h3>
      <ol>
        {session.items.map((item, index) => {
          const current = index === session.currentIndex;
          const done = item.finalPoints !== null;
          const body = (
            <>
              <span className="poker-queue-mark" aria-hidden="true">{done ? <Icon name="check" /> : index + 1}</span>
              <span className="poker-queue-title">{item.title}</span>
              <span className="poker-queue-points" data-done={done ? "true" : undefined}>
                {done ? pointsLabel(t, tp, item.finalPoints ?? 0) : item.storyPoints !== null ? pointsLabel(t, tp, item.storyPoints) : ""}
              </span>
            </>
          );
          return (
            <li key={item.taskId} data-current={current ? "true" : undefined} data-done={done ? "true" : undefined}>
              {canJump
                ? <button type="button" disabled={disabled} aria-current={current ? "step" : undefined} onClick={() => onJump(index)}>{body}</button>
                : <div aria-current={current ? "step" : undefined}>{body}</div>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
