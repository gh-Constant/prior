// Thanks a teammate for a completed shared-project task. The server decides
// who completed it and caps the XP; this only offers the gesture.
import { useState } from "react";
import { api } from "../../lib/api";
import { getToken, getUser } from "../../lib/auth";
import { collaborationStore } from "../../lib/collaborationStore";
import { useI18n } from "../../lib/i18n";
import { emitPetReaction } from "../../lib/gamification/celebrations";
import { useGame } from "../../lib/gamification/gameStore";
import type { Task } from "../../types";
import { Icon } from "../Icon";
import "./KudosButton.css";

export function KudosButton({ task }: { readonly task: Pick<Task, "id" | "completed" | "projectId" | "peopleIds"> }) {
  const { t } = useI18n();
  const { enabled } = useGame();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  if (!enabled || !task.completed || !task.projectId || !collaborationStore.isShared(task.projectId)) return null;
  // Your own work gets no kudos button: the server would refuse it anyway.
  const me = getUser()?.id;
  const people = task.peopleIds ?? [];
  if (people.length > 0 && people.every((id) => id === me)) return null;

  async function send() {
    setState("sending");
    try {
      const token = await getToken();
      if (!token) throw new Error("signed out");
      await api.giveKudos(task.id, token);
      setState("sent");
      emitPetReaction("hop");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="kudos">
      <button type="button" className={`kudos-button ${state === "sent" ? "is-sent" : ""}`} disabled={state === "sending" || state === "sent"} onClick={() => void send()}>
        <Icon name="heart" />
        {state === "sent" ? t("game.kudos.given") : t("game.kudos.give")}
      </button>
      {state === "failed" && <span className="kudos-error" role="alert">{t("game.kudos.failed")}</span>}
    </div>
  );
}
