"use client";

import { Card, Button } from "@/shared/components";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Monitor, Download, Upload, Sun, Moon, Contrast } from "lucide-react";
import { translate } from "@/i18n/runtime";
import { cn } from "@/lib/utils";
import type { StatusMessage } from "../types";

interface LocalModeCardProps {
  theme: string;
  setTheme: (theme: "light" | "dark" | "system") => void;
  isDark: boolean;
  dbLoading: boolean;
  dbStatus: StatusMessage;
  dbAuth: { open: boolean; mode: string; password: string };
  setDbAuth: React.Dispatch<React.SetStateAction<{ open: boolean; mode: string; password: string }>>;
  importFileRef: React.RefObject<HTMLInputElement | null>;
  handleExportDatabase: (password: string) => Promise<void>;
  handleImportDatabase: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleDbAuthConfirm: () => Promise<void>;
}

export default function LocalModeCard({
  theme, setTheme, isDark,
  dbLoading, dbStatus, dbAuth, setDbAuth, importFileRef,
  handleExportDatabase, handleImportDatabase, handleDbAuthConfirm,
}: LocalModeCardProps) {
  return (
    <Card>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="size-10 sm:size-12 rounded-lg bg-green-500/10 text-green-500 flex items-center justify-center shrink-0">
            <Monitor className="size-4" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-semibold">{translate("Local Mode")}</h2>
            <p className="text-sm text-text-muted">{translate("Running on your machine")}</p>
          </div>
        </div>
        <div className="inline-flex p-1 rounded-lg bg-black/5 dark:bg-white/5 w-full sm:w-auto">
          {["light", "dark", "system"].map((option) => (
            <Button
              key={option}
              variant="ghost"
              size="sm"
              onClick={() => setTheme(option as "light" | "dark" | "system")}
              className={cn(
                "flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-md font-medium transition-all flex-1 sm:flex-initial",
                theme === option
                  ? "bg-white dark:bg-white/10 text-text-main shadow-sm"
                  : "text-text-muted hover:text-text-main"
              )}
            >
              {option === "light" ? <Sun className="size-4" /> : option === "dark" ? <Moon className="size-4" /> : <Contrast className="size-4" />}
              <span className="capitalize text-xs sm:text-sm">{option}</span>
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3 pt-4 border-t border-border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 rounded-lg bg-bg border border-border gap-2">
          <div>
            <p className="font-medium text-sm sm:text-base">{translate("Database Location")}</p>
            <p className="text-xs sm:text-sm text-text-muted font-mono break-all">~/.modelhub/db/data.sqlite</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="secondary"
            icon={<Download className="size-4" />}
            onClick={() => setDbAuth({ open: true, mode: "export", password: "" })}
            loading={dbLoading}
            className="w-full sm:w-auto"
          >
            {translate("Download Backup")}
          </Button>
          <Button
            variant="outline"
            icon={<Upload className="size-4" />}
            onClick={() => importFileRef.current?.click()}
            disabled={dbLoading}
            className="w-full sm:w-auto"
          >
            {translate("Import Backup")}
          </Button>
          <ShadcnInput
            ref={importFileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportDatabase}
          />
        </div>
        {dbStatus.message && (
          <p className={`text-sm ${dbStatus.type === "error" ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>
            {dbStatus.message}
          </p>
        )}
      </div>
    </Card>
  );
}
