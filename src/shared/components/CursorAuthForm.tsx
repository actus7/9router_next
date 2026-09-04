"use client";

import { Button } from "@/components/ui/button";
import { FormInput as Input } from "@/shared/components/FormInput";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { translate } from "@/i18n/runtime";

interface CursorAuthFormProps {
  accessToken: string;
  setAccessToken: (v: string) => void;
  machineId: string;
  setMachineId: (v: string) => void;
  error: string | null;
  importing: boolean;
  onImport: () => void;
  onClose: () => void;
}

export function CursorAuthForm({ accessToken, setAccessToken, machineId, setMachineId, error, importing, onImport, onClose }: CursorAuthFormProps) {
  return (
    <>
      <div>
        <Label className="block mb-2">{translate("Access Token")} <span className="text-destructive-foreground">*</span></Label>
        <Textarea value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder={translate("Access token will be auto-filled...") ?? "Access token will be auto-filled..."} rows={3} className="font-mono resize-none" />
      </div>
      <div>
        <Label className="block mb-2">{translate("Machine ID")} <span className="text-destructive-foreground">*</span></Label>
        <Input value={machineId} onChange={(e) => setMachineId(e.target.value)} placeholder={translate("Machine ID will be auto-filled...") ?? "Machine ID will be auto-filled..."} className="font-mono text-sm" />
      </div>
      {error && (
        <div className="bg-destructive dark:bg-destructive p-3 rounded-lg border border-destructive-border dark:border-destructive-border">
          <p className="text-sm text-destructive-foreground dark:text-destructive-foreground">{error}</p>
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={onImport} fullWidth disabled={importing || !accessToken.trim() || !machineId.trim()}>
          {importing ? (translate("Importing...") ?? "Importing...") : (translate("Import Token") ?? "Import Token")}
        </Button>
        <Button onClick={onClose} variant="ghost" fullWidth>{translate("Cancel")}</Button>
      </div>
    </>
  );
}
