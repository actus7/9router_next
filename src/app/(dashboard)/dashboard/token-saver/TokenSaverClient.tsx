"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import { Card, ConfirmModal } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { jsonFetcher } from "@/shared/hooks/jsonFetcher";
import { CAVEMAN_LEVELS, PONYTAIL_LEVELS } from "../endpoint/endpointConstants";
import { Zap } from "lucide-react";
import { useHeadroom } from "./hooks/useHeadroom";
import { usePxpipe } from "./hooks/usePxpipe";
import { useTokenSaverSettings } from "./hooks/useTokenSaverSettings";
import HeadroomSection from "./sections/HeadroomSection";
import HeadroomModal from "./sections/HeadroomModal";
import PxpipeSection from "./sections/PxpipeSection";
import PxpipeModal from "./sections/PxpipeModal";

export default function TokenSaverClient() {
  const settings = useTokenSaverSettings();
  const headroom = useHeadroom();
  const pxpipe = usePxpipe();
  const {  } = useCopyToClipboard();
  const { data } = useSWR<Record<string, unknown>>("/api/settings", jsonFetcher);
  const statusChecksStartedRef = useRef(false);

  useEffect(() => {
    if (!data) return;
    settings.setRtkEnabledState(data.rtkEnabled !== false);
    headroom.setHeadroomEnabled(!!data.headroomEnabled);
    headroom.setHeadroomUrl((data.headroomUrl as string) || "http://localhost:8787");
    // codeAware and kompress are managed inside useHeadroom
    settings.setCavemanEnabled(!!data.cavemanEnabled);
    settings.setCavemanLevel((data.cavemanLevel as string) || "full");
    settings.setPonytailEnabled(!!data.ponytailEnabled);
    settings.setPonytailLevel((data.ponytailLevel as string) || "full");
    pxpipe.setPxpipeEnabled(!!data.pxpipeEnabled);
    if (typeof data.pxpipeMinChars === "number") pxpipe.setPxpipeMinChars(data.pxpipeMinChars);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable; only settings data should hydrate local state
  }, [data]);

  useEffect(() => {
    if (statusChecksStartedRef.current) return;
    statusChecksStartedRef.current = true;
    headroom.refreshHeadroomStatus();
    // PRD: run the PXPIPE health check automatically when the page opens
    pxpipe.refreshPxpipeStatus().then(pxpipe.runPxpipeHealth);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- status callbacks are stable useCallback([]) references
  }, []);

  return (
    <div className="flex flex-col gap-6 p-6">
      <Card id="rtk">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="size-4" />
            Token Saver
          </h2>
        </div>
        <div className="flex items-center justify-between pt-2 pb-4 border-b border-border gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress tool output{" "}
              <a
                href="https://github.com/rtk-ai/rtk"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (RTK)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              git/grep/ls/tree/logs → 60-90% fewer input tokens
            </p>
          </div>
          <Switch
            checked={settings.rtkEnabled}
            onCheckedChange={() => settings.handleRtkEnabled(!settings.rtkEnabled)}
          />
        </div>

        <HeadroomSection
          headroomRunning={headroom.headroomRunning}
          headroomStatusLabel={headroom.headroomStatusLabel}
          headroomEnabled={headroom.headroomEnabled}
          handleHeadroomEnabled={headroom.handleHeadroomEnabled}
          setShowHeadroomInstallModal={headroom.setShowHeadroomInstallModal}
          headroomStatus={headroom.headroomStatus}
          headroomExtras={headroom.headroomExtras}
          pendingExtras={headroom.pendingExtras}
          togglePendingExtra={headroom.togglePendingExtra}
          codeAware={headroom.codeAware}
          kompress={headroom.kompress}
          restartingProxy={headroom.restartingProxy}
          toggleExtraActive={headroom.toggleExtraActive}
          handleRemoveExtra={headroom.handleRemoveExtra}
          removingExtra={headroom.removingExtra}
          handleInstallExtras={headroom.handleInstallExtras}
          extrasActionLoading={headroom.extrasActionLoading}
          extrasActionError={headroom.extrasActionError}
          installLog={headroom.installLog}
        />

        <div className="flex items-center justify-between pt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress LLM output{" "}
              <a
                href="https://github.com/JuliusBrussee/caveman"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Caveman)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Terse-style system prompt → ~65% fewer output tokens (up to 87%)
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {settings.cavemanEnabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {settings.visibleCavemanLevels.map((lvl) => (
                    <Button
                      key={lvl.id}
                      variant={settings.cavemanLevel === lvl.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => settings.handleCavemanLevel(lvl.id)}
                      title={lvl.desc}
                    >
                      {lvl.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-primary">
                  {
                    CAVEMAN_LEVELS.find((lvl) => lvl.id === settings.cavemanLevel)
                      ?.desc
                  }
                </p>
              </div>
            )}
            <Switch
              checked={settings.cavemanEnabled}
              onCheckedChange={() => settings.handleCavemanEnabled(!settings.cavemanEnabled)}
            />
          </div>
        </div>
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Lazy senior dev{" "}
              <a
                href="https://github.com/DietrichGebert/ponytail"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Ponytail)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Bias the model toward minimal code: YAGNI, reuse stdlib,
              deletion over addition
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {settings.ponytailEnabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {PONYTAIL_LEVELS.map((lvl) => (
                    <Button
                      key={lvl.id}
                      variant={settings.ponytailLevel === lvl.id ? "default" : "outline"}
                      size="sm"
                      onClick={() => settings.handlePonytailLevel(lvl.id)}
                      title={lvl.desc}
                    >
                      {lvl.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-primary">
                  {
                    PONYTAIL_LEVELS.find((lvl) => lvl.id === settings.ponytailLevel)
                      ?.desc
                  }
                </p>
              </div>
            )}
            <Switch
              checked={settings.ponytailEnabled}
              onCheckedChange={() => settings.handlePonytailEnabled(!settings.ponytailEnabled)}
            />
          </div>
        </div>

        <PxpipeSection
          pxpipeEnabled={pxpipe.pxpipeEnabled}
          pxpipeStatus={pxpipe.pxpipeStatus}
          pxpipeStatusLabel={pxpipe.pxpipeStatusLabel}
          pxpipeChipClass={pxpipe.pxpipeChipClass}
          setShowPxpipeModal={pxpipe.setShowPxpipeModal}
          handlePxpipeEnabled={pxpipe.handlePxpipeEnabled}
        />
      </Card>

      <HeadroomModal
        showHeadroomInstallModal={headroom.showHeadroomInstallModal}
        setShowHeadroomInstallModal={headroom.setShowHeadroomInstallModal}
        headroomRunning={headroom.headroomRunning}
        headroomStatusLabel={headroom.headroomStatusLabel}
        headroomUrl={headroom.headroomUrl}
        setHeadroomUrl={headroom.setHeadroomUrl}
        handleHeadroomUrlBlur={headroom.handleHeadroomUrlBlur}
        headroomManaged={headroom.headroomManaged}
        headroomCanStart={headroom.headroomCanStart}
        headroomLocalUrl={headroom.headroomLocalUrl}
        headroomStatus={headroom.headroomStatus}
        headroomActionLoading={headroom.headroomActionLoading}
        headroomActionError={headroom.headroomActionError}
        handleHeadroomStart={headroom.handleHeadroomStart}
        handleHeadroomStop={headroom.handleHeadroomStop}
        refreshHeadroomStatus={headroom.refreshHeadroomStatus}
      />

      <PxpipeModal
        showPxpipeModal={pxpipe.showPxpipeModal}
        setShowPxpipeModal={pxpipe.setShowPxpipeModal}
        pxpipeStatus={pxpipe.pxpipeStatus}
        pxpipeHealthy={pxpipe.pxpipeHealthy}
        pxpipeStatusLabel={pxpipe.pxpipeStatusLabel}
        pxpipeHealth={pxpipe.pxpipeHealth}
        pxpipeMinChars={pxpipe.pxpipeMinChars}
        setPxpipeMinChars={pxpipe.setPxpipeMinChars}
        handlePxpipeMinCharsBlur={pxpipe.handlePxpipeMinCharsBlur}
        pxpipeActionLoading={pxpipe.pxpipeActionLoading}
        pxpipeActionError={pxpipe.pxpipeActionError}
        pxpipeAction={pxpipe.pxpipeAction}
        refreshPxpipeStatus={pxpipe.refreshPxpipeStatus}
        runPxpipeHealth={pxpipe.runPxpipeHealth}
      />

      <ConfirmModal
        isOpen={!!headroom.extrasConfirm}
        onClose={() => headroom.setExtrasConfirm(null)}
        onConfirm={() => {
          const fn = headroom.extrasConfirm?.onConfirm;
          headroom.setExtrasConfirm(null);
          fn?.();
        }}
        title={headroom.extrasConfirm?.title}
        message={headroom.extrasConfirm?.message}
        confirmText={headroom.extrasConfirm?.confirmText}
        variant={headroom.extrasConfirm?.variant}
      />
    </div>
  );
}


