"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DynamicMedia } from "@/components/ui/dynamic-media";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Row } from "./exampleShared";
import { Wifi, X } from "lucide-react";
import type { useGenericExampleState } from "./useGenericExampleState";

type GenericState = ReturnType<typeof useGenericExampleState>;
// The hook can return null when kindConfig/exConfig is missing
type NonNullGenericState = NonNullable<GenericState>;

export default function GenericFormFields({ state }: { state: NonNullGenericState }) {
  const {
    kindModels, allowManualModel,
    selectedModel, setSelectedModel, selectedModelObj,
    supportsEdit, supportsMask,
    input, setInput, exConfig,
    refImage, setRefImage, refImagePreviewSrc,
    maskImage, setMaskImage, maskImagePreviewSrc,
    extraValues, setExtraValues,
    endpoint, tunnelEndpoint, apiPath,
    useTunnel, setUseTunnel,
    apiKey,
    connections, pinnedConnectionId, setPinnedConnectionId,
    kind, imageOutputFormat, setImageOutputFormat,
  } = state;

  return (
    <>
      {/* Model selector */}
      {kindModels.length > 0 ? (
        <Row label="Model">
          <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {kindModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name || m.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      ) : allowManualModel ? (
        <Row label="Model">
          <Input
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            placeholder="Enter model id (provider-specific)"
            className="w-full px-3 py-1.5 text-sm font-mono"
          />
        </Row>
      ) : null}

      {/* Endpoint */}
      <Row label="Endpoint">
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <span className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate">
            {endpoint}{apiPath}
          </span>
          {tunnelEndpoint && (
            <Button
              variant={useTunnel ? "default" : "outline"}
              size="sm"
              onClick={() => setUseTunnel((v) => !v)}
              title={useTunnel ? "Using tunnel" : "Using local"}
              className="shrink-0"
            >
              <Wifi className="size-4" />
              Tunnel
            </Button>
          )}
        </div>
      </Row>

      {/* API Key */}
      <Row label="API Key">
        <span className="px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate block">
          {apiKey ? `${apiKey.slice(0, 8)}${"\u2022".repeat(Math.min(20, apiKey.length - 8))}` : <span className="text-text-muted italic">No key configured</span>}
        </span>
      </Row>

      {/* Connection picker */}
      {connections.length > 0 && (
        <Row label="Connection">
          <Select value={pinnedConnectionId || "__auto__"} onValueChange={(v) => setPinnedConnectionId((v ?? "") === "__auto__" ? "" : (v ?? ""))}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Auto (by priority)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__auto__">Auto (by priority)</SelectItem>
              {connections.map((c) => {
                const plan = c.providerSpecificData?.chatgptPlanType;
                const label = c.email || c.name || c.id.slice(0, 8);
                return (
                  <SelectItem key={c.id} value={c.id}>
                    {label}{plan ? ` [${plan}]` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </Row>
      )}

      {/* Input */}
      <Row label={exConfig.inputLabel || "Input"}>
        <div className="relative">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={exConfig.inputPlaceholder}
            className="w-full px-3 py-1.5 pr-7 text-sm"
          />
          {input && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setInput("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </Row>

      {/* Reference image */}
      {supportsEdit && (
        <Row label="Ref Image (URL)">
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Input
                value={refImage}
                onChange={(e) => setRefImage(e.target.value)}
                placeholder="https://example.com/source.png"
                className="w-full px-3 py-1.5 pr-7 text-sm"
              />
              {refImage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setRefImage("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
            {refImagePreviewSrc && (
              <DynamicMedia
                src={refImagePreviewSrc}
                alt="Reference"
                className="max-h-40 rounded-lg border border-border object-contain bg-sidebar"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
                onLoad={(e) => { e.currentTarget.style.display = "block"; }}
              loading="lazy"
              decoding="async"
              />
            )}
          </div>
        </Row>
      )}

      {supportsMask && (
        <Row label="Mask (URL)">
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Input
                value={maskImage}
                onChange={(e) => setMaskImage(e.target.value)}
                placeholder="https://example.com/mask.png"
                className="w-full px-3 py-1.5 pr-7 text-sm"
              />
              {maskImage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setMaskImage("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
            {maskImagePreviewSrc && (
              <DynamicMedia
                src={maskImagePreviewSrc}
                alt="Mask"
                className="max-h-40 rounded-lg border border-border object-contain bg-sidebar"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
                onLoad={(e) => { e.currentTarget.style.display = "block"; }}
              loading="lazy"
              decoding="async"
              />
            )}
          </div>
        </Row>
      )}

      {/* Extra fields */}
      {(exConfig.extraFields || [])
        .filter((f) => kindModels.length === 0 || (Array.isArray(selectedModelObj?.params) && selectedModelObj.params.includes(f.key)))
        .map((f) => (
        <Row key={f.key} label={f.label}>
          {f.type === "select" ? (
            <Select value={String(extraValues[f.key] || "__default__")} onValueChange={(v) => setExtraValues((s) => ({ ...s, [f.key]: (v ?? "") === "__default__" ? "" : (v ?? "") }))}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="(default)" />
              </SelectTrigger>
              <SelectContent>
                {(f.options || []).map((opt) => (
                  <SelectItem key={opt || "__default__"} value={opt || "__default__"}>{opt === "" ? "(default)" : opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : f.type === "text" ? (
            <Input
              type="text"
              value={extraValues[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => setExtraValues((s) => ({ ...s, [f.key]: e.target.value }))}
              className="w-full px-3 py-1.5 text-sm"
            />
          ) : (
            <Input
              type="number"
              value={extraValues[f.key] ?? ""}
              min={f.min}
              max={f.max}
              onChange={(e) => setExtraValues((s) => ({ ...s, [f.key]: e.target.value === "" ? "" : Number(e.target.value) }))}
              className="w-full px-3 py-1.5 text-sm"
            />
          )}
        </Row>
      ))}

      {/* Output Format toggle (image only) */}
      {kind === "image" && (
        <Row label="Output Format">
          <Select value={imageOutputFormat} onValueChange={(v) => setImageOutputFormat(v ?? "json")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Output format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json">JSON (Base64)</SelectItem>
              <SelectItem value="binary">Binary File</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      )}
    </>
  );
}
