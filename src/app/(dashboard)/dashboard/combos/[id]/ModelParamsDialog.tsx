"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { translate } from "@/i18n/runtime";
import type { LaneEntryConfig } from "@/shared/llm-catalog";
import type { ParamDef } from "./useModelParamInfo";
import { isParamApplicable } from "./paramApplicability";

type Values = NonNullable<LaneEntryConfig["params"]>;

const GROUP_ORDER = ["generation_length", "sampling", "reasoning", "tooling", "output_format", "observability", "provider_metadata"];
const GROUP_LABELS: Record<string, string> = {
  generation_length: "Generation length", sampling: "Sampling", reasoning: "Reasoning", tooling: "Tooling",
  output_format: "Output format", observability: "Observability", provider_metadata: "Provider metadata",
};
const FIELD = "h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30";

function Control({ def, value, onChange }: { def: ParamDef; value: Values[string] | undefined; onChange: (next: Values[string] | undefined) => void }) {
  const set = value !== undefined;
  if (def.type === "boolean") {
    return <Switch checked={set ? value === true : def.default === true} onCheckedChange={(checked) => onChange(checked)} />;
  }
  if (def.values && def.values.length > 0) {
    return (
      <select className={FIELD} value={set ? String(value) : ""} onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === "" ? undefined : def.values?.find((item) => String(item) === raw) as Values[string]);
      }}>
        <option value="">{String(def.default ?? "—")}</option>
        {def.values.map((item) => <option key={String(item)} value={String(item)}>{String(item)}</option>)}
      </select>
    );
  }
  if (def.type === "integer" || def.type === "number") {
    return (
      <input
        type="number"
        className={`${FIELD} w-28`}
        min={def.range?.min}
        max={def.range?.max}
        step={def.range?.step ?? (def.type === "integer" ? 1 : "any")}
        placeholder={def.default === undefined ? "" : String(def.default)}
        value={set ? String(value) : ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    );
  }
  return <input className={`${FIELD} w-40`} placeholder={def.default === undefined ? "" : String(def.default)} value={set ? String(value) : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />;
}

export default function ModelParamsDialog({ modelName, params, initial, onSave, onClose }: {
  modelName: string;
  params: ParamDef[];
  initial: Values | undefined;
  onSave: (values: Values | undefined) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Values>(initial ?? {});
  // Defaults underneath, what the user set on top: a parameter the catalog says does not apply is hidden, not offered.
  const effective: Record<string, unknown> = { ...Object.fromEntries(params.filter((p) => p.default !== undefined).map((p) => [p.path, p.default])), ...draft };
  const visible = params.filter((param) => isParamApplicable(param.applicability, effective));
  const groups = [...new Set(visible.map((param) => param.group ?? "other"))]
    .sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
  const update = (path: string, next: Values[string] | undefined) => setDraft((cur) => {
    const copy = { ...cur };
    if (next === undefined) delete copy[path]; else copy[path] = next;
    return copy;
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{translate("Model parameters") || "Model parameters"}</DialogTitle>
          <p className="text-sm text-text-muted">
            {`${translate("Values you set override the client's request for") || "Values you set override the client's request for"} ${modelName}; ${translate("unset ones keep the client's value. Requests that name a model instead of auto skip them.") || "unset ones keep the client's value. Requests that name a model instead of auto skip them."}`}
          </p>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-text-main">{translate(GROUP_LABELS[group] ?? group) || GROUP_LABELS[group] || group}</h3>
              <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {visible.filter((param) => (param.group ?? "other") === group).map((def) => (
                  <div key={def.path} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-main">{def.label ?? def.path} <code className="ml-1 rounded bg-muted px-1 text-[11px] text-text-muted">{def.path}</code></p>
                      {def.description && <p className="mt-0.5 text-xs text-text-muted">{def.description}</p>}
                      <p className="mt-0.5 text-xs text-text-muted">
                        {translate("Default") || "Default"}: {def.default === undefined ? "—" : String(def.default)} · {draft[def.path] === undefined ? (translate("Not set") || "Not set") : (translate("Set") || "Set")}
                        {draft[def.path] !== undefined && <> · <button type="button" className="underline" onClick={() => update(def.path, undefined)}>{translate("Reset") || "Reset"}</button></>}
                      </p>
                    </div>
                    <Control def={def} value={draft[def.path]} onChange={(next) => update(def.path, next)} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{translate("Cancel") || "Cancel"}</Button>
          <Button onClick={() => onSave(Object.keys(draft).length > 0 ? draft : undefined)}>{translate("Save") || "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
