"use client";

import { Bot, CheckCircle2, CircleAlert, LoaderCircle, Wrench } from "lucide-react";
import type { AgentActivity } from "../hooks/useSendMessageTypes";

interface ChatLiveRunStatusProps {
  active: boolean;
  activities: AgentActivity[];
}

const stateStyles: Record<AgentActivity["state"], string> = {
  running: "text-primary",
  streaming: "text-primary",
  done: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
};

export default function ChatLiveRunStatus({ active, activities }: ChatLiveRunStatusProps) {
  if (!active && activities.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-4xl px-4 pb-2" aria-live="polite" aria-label="Atividade do agente">
      <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
            <LoaderCircle className="size-3.5 animate-spin text-primary" />
            <span>Agente trabalhando</span>
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">{activities.filter((activity) => activity.state === "running" || activity.state === "streaming").length} em andamento</span>
        </div>
        {activities.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {activities.map((activity) => {
              const Icon = activity.label === "Pensando" || activity.label === "Respondendo" || activity.label === "Sintetizando" ? Bot : Wrench;
              const StateIcon = activity.state === "done" ? CheckCircle2 : activity.state === "error" ? CircleAlert : Icon;
              return (
                <span key={activity.id} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] text-foreground">
                  <StateIcon className={`size-3 shrink-0 ${stateStyles[activity.state]} ${activity.state === "running" || activity.state === "streaming" ? "animate-pulse" : ""}`} />
                  <span className="truncate font-medium">{activity.label}</span>
                  {activity.detail ? <span className="truncate text-muted-foreground">{activity.detail}</span> : null}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
