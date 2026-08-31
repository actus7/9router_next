import { CapacityBadges } from "@/shared/components";
import Button from "@/shared/components/Button";
import { Beaker, Bot, Check, CheckCircle2, Copy, Loader2, X } from "lucide-react";
import { translate } from "@/i18n/runtime";

interface ModelRowProps {
  model: { id: string; name?: string };
  fullModel: string;
  alias?: string;
  copied?: string;
  onCopy: (text: string, id: string) => void;
  testStatus?: "ok" | "error";
  isCustom?: boolean;
  isFree?: boolean;
  onDeleteAlias?: () => void;
  onTest?: () => void;
  isTesting?: boolean;
  onDisable?: () => void;
  caps?: Record<string, unknown>;
  thinkingSuffix?: string | null;
}

export default function ModelRow({ model, fullModel, alias, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting, onDisable, caps, thinkingSuffix }: ModelRowProps) {
  const displayModel = thinkingSuffix ? `${fullModel}(${thinkingSuffix})` : fullModel;
  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`group min-w-0 max-w-full rounded-lg border px-3 py-2 transition-colors ${borderColor} hover:bg-sidebar/50`}>
      <div className="flex min-w-0 items-start gap-2.5 sm:items-center">
        <span
          className="shrink-0 text-base"
          style={iconColor ? { color: iconColor } : undefined}
        >
          {testStatus === "ok" ? <CheckCircle2 className="size-4" /> : testStatus === "error" ? <X className="size-4" /> : <Bot className="size-4" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <code className="max-w-[52vw] truncate font-mono text-xs font-medium text-text-main sm:max-w-[260px]">{displayModel}</code>
          <span className="flex min-w-0 items-center gap-1 pl-0.5 text-[10px]">
            {model.name && <span className="truncate italic text-text-muted/70">{model.name}</span>}
            <CapacityBadges caps={caps} colorOverride="text-text-muted/70" size={12} />
          </span>
        </div>
        {onTest && (
          <div className="relative shrink-0 group/btn">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onTest}
              disabled={isTesting}
              className={isTesting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}
            >
              <span className="text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isTesting ? <Loader2 className="size-4" /> : <Beaker className="size-4" />}
              </span>
            </Button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? translate("Testing...") : translate("Test")}
            </span>
          </div>
        )}
        <div className="relative shrink-0 group/btn">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onCopy(displayModel, `model-${model.id}`)}
          >
            <span className="text-sm">
              {copied === `model-${model.id}` ? <Check className="size-4" /> : <Copy className="size-4" />}
            </span>
          </Button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {copied === `model-${model.id}` ? translate("Copied!") : translate("Copy")}
          </span>
        </div>
        {isCustom ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDeleteAlias}
            className="ml-auto text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-500"
            title="Remove custom model"
          >
            <X className="size-4" />
          </Button>
        ) : onDisable ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDisable}
            className="ml-auto text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-500"
            title="Disable this model"
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
