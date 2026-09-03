import type { RoutingTrace, RoutingTraceStep } from "@/shared/observability/routingTrace";

export interface RoutingTraceLine {
  /** "ok" the model that answered, "fail" a rejected attempt, "info" a decision. */
  tone: "info" | "ok" | "fail";
  title: string;
  detail?: string;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isStep(value: unknown): value is RoutingTraceStep {
  return Boolean(value) && typeof value === "object" && typeof (value as { kind?: unknown }).kind === "string";
}

/** Read a journal event's `data` back into a trace, tolerating anything unexpected. */
export function readRoutingTrace(data: Record<string, unknown> | null | undefined): RoutingTrace | null {
  if (!data || typeof data.requestedModel !== "string") return null;
  const steps = Array.isArray(data.steps) ? data.steps.filter(isStep) : [];
  return {
    requestedModel: data.requestedModel,
    steps,
    ...(typeof data.selectedModel === "string" ? { selectedModel: data.selectedModel } : {}),
    ...(data.truncated === true ? { truncated: true } : {}),
  };
}

function describeStep(step: RoutingTraceStep): RoutingTraceLine {
  switch (step.kind) {
    case "combo": {
      const models = readStringArray(step.models);
      return {
        tone: "info",
        title: `Combo "${step.name}" · ${step.strategy}`,
        detail: models.length > 0 ? `${models.length} models: ${models.join(", ")}` : undefined,
      };
    }
    case "smart": {
      const candidates = readStringArray(step.candidates);
      const facts = [
        `need ${step.need}`,
        `tier ${step.tier}`,
        step.reason ? `reason ${step.reason}` : "",
        step.degraded ? "degraded" : "",
        step.classifierModel ? `classifier ${step.classifierModel}` : "",
      ].filter(Boolean);
      return {
        tone: "info",
        title: `Smart routing "${step.name}" · ${facts.join(" · ")}`,
        detail: candidates.length > 0 ? `${candidates.length} candidates: ${candidates.join(", ")}` : undefined,
      };
    }
    case "adapter": {
      const capabilities = readStringArray(step.capabilities);
      return {
        tone: "info",
        title: `Capacity adapter for ${step.requested} · ${step.strategy}`,
        detail: capabilities.length > 0 ? `needs ${capabilities.join(", ")}` : undefined,
      };
    }
    case "attempt":
      return {
        tone: step.outcome === "ok" ? "ok" : "fail",
        title: `Attempt ${step.index}/${step.total}: ${step.model} — ${step.outcome}`,
        detail: step.error,
      };
    case "account": {
      const where = step.connection ? `${step.provider}/${step.model} (${step.connection})` : `${step.provider}/${step.model}`;
      return {
        tone: step.outcome === "selected" ? "ok" : "fail",
        title: `${where} — ${step.outcome}${step.status ? ` (${step.status})` : ""}`,
        detail: step.error,
      };
    }
    default: {
      const exhaustive: never = step;
      return exhaustive;
    }
  }
}

/**
 * Turn a trace into readable lines for the journal. Ends with an explicit
 * outcome line so the model that actually answered is never buried under the
 * list of the ones that failed.
 */
export function routingTraceLines(trace: RoutingTrace): RoutingTraceLine[] {
  const lines = trace.steps.map(describeStep);
  if (trace.truncated) {
    lines.push({ tone: "info", title: "Trace truncated to fit the response header", detail: "Some steps or lists were dropped." });
  }
  lines.push(trace.selectedModel
    ? { tone: "ok", title: `Answered by ${trace.selectedModel}` }
    : { tone: "fail", title: "No model answered this request" });
  return lines;
}

/** One-line preview for the collapsed journal row. */
export function routingTraceSummary(trace: RoutingTrace): string {
  const failures = trace.steps.filter((step) =>
    (step.kind === "account" && step.outcome !== "selected") || (step.kind === "attempt" && step.outcome !== "ok")).length;
  const parts = [`${trace.requestedModel} →`, trace.selectedModel || "no model answered"];
  if (failures > 0) parts.push(`after ${failures} failed ${failures === 1 ? "attempt" : "attempts"}`);
  return parts.join(" ");
}
