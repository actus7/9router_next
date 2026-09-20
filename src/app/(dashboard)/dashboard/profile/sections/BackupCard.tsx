"use client";

import Card from "@/shared/components/Card";
import { Button } from "@/components/ui/button";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Database, Download, Upload } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { StatusMessage } from "../types";

interface BackupCardProps {
  dbLoading: boolean;
  dbStatus: StatusMessage;
  importFileRef: React.RefObject<HTMLInputElement | null>;
  handleExportDatabase: () => Promise<void>;
  handleImportDatabase: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function BackupCard({
  dbLoading, dbStatus, importFileRef, handleExportDatabase, handleImportDatabase,
}: BackupCardProps) {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="size-10 rounded-lg bg-success text-success-foreground flex items-center justify-center shrink-0">
          <Database className="size-5" />
        </div>
        <div>
          <h3 className="text-base sm:text-lg font-semibold">{translate("Backup")}</h3>
          <p className="text-xs sm:text-sm text-text-muted">{translate("Export or import this account's data")}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="secondary"
            icon={<Download className="size-4" />}
            onClick={handleExportDatabase}
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
          <p className={`text-sm ${dbStatus.type === "error" ? "text-destructive" : "text-success"}`}>
            {dbStatus.message}
          </p>
        )}
      </div>
    </Card>
  );
}
