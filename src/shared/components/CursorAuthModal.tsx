"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button, Input } from "@/shared/components";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Info, Loader2, X } from "lucide-react";

interface CursorAuthModalProps {
  isOpen: boolean;
  onSuccess?: () => void;
  onClose: () => void;
}

/**
 * Cursor Auth Modal
 * Auto-detect and import token from Cursor IDE's local SQLite database
 */
export default function CursorAuthModal({ isOpen, onSuccess, onClose }: CursorAuthModalProps) {
  const [accessToken, setAccessToken] = useState<string>("");
  const [machineId, setMachineId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<boolean>(false);
  const [autoDetecting, setAutoDetecting] = useState<boolean>(false);
  const [autoDetected, setAutoDetected] = useState<boolean>(false);
  const [windowsManual, setWindowsManual] = useState<boolean>(false);

  const runAutoDetect = async () => {
    setAutoDetecting(true);
    setError(null);
    setAutoDetected(false);
    setWindowsManual(false);

    try {
      const res = await fetch("/api/oauth/cursor/auto-import");
      const data = await res.json();

      if (data.found) {
        setAccessToken(data.accessToken);
        setMachineId(data.machineId);
        setAutoDetected(true);
      } else if (data.windowsManual) {
        setWindowsManual(true);
      } else {
        setError(data.error || "Could not auto-detect tokens");
      }
    } catch (err) {
      setError("Failed to auto-detect tokens");
    } finally {
      setAutoDetecting(false);
    }
  };

  // Auto-detect tokens when modal opens
  useEffect(() => {
    if (!isOpen) return;
    runAutoDetect();
  }, [isOpen]);

  const handleImportToken = async () => {
    if (!accessToken.trim()) {
      setError("Please enter an access token");
      return;
    }

    if (!machineId.trim()) {
      setError("Please enter a machine ID");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/cursor/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          machineId: machineId.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      onSuccess?.();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "bg-surface border border-border-subtle rounded-[14px]",
          "shadow-[var(--shadow-elev)] ring-0 gap-0 p-0",
          "max-w-md"
        )}
      >
        <div className="flex items-center justify-between p-2 border-b border-border-subtle">
          <DialogTitle className="text-lg font-semibold text-text-main ml-2">
            Conectar Cursor IDE
          </DialogTitle>
          <Button onClick={onClose} aria-label="Fechar" variant="ghost" size="sm" className="p-1.5">
            <X className="size-5" />
          </Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="flex flex-col gap-4">
        {/* Auto-detecting state */}
        {autoDetecting && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="size-4" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Detectando tokens automaticamente...</h3>
            <p className="text-sm text-text-muted">
              Lendo do banco de dados do Cursor IDE
            </p>
          </div>
        )}

        {/* Form (shown after auto-detect completes) */}
        {!autoDetecting && (
          <>
            {/* Success message if auto-detected */}
            {autoDetected && (
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex gap-2">
                  <CheckCircle2 className="size-4" />
                  <p className="text-sm text-green-800 dark:text-green-200">
                    Tokens detectados automaticamente do Cursor IDE com sucesso!
                  </p>
                </div>
              </div>
            )}

            {/* Windows manual instructions */}
            {windowsManual && (
              <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800 flex flex-col gap-2">
                <div className="flex gap-2 items-center">
                  <Info className="size-4" />
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Não foi possível ler o banco de dados do Cursor automaticamente.
                  </p>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Certifique-se de que o Cursor IDE foi aberto pelo menos uma vez, depois clique em <strong>Tentar novamente</strong>. Se o problema persistir, cole seus tokens manualmente abaixo.
                </p>
                <Button onClick={runAutoDetect} variant="outline" fullWidth>
                  Tentar novamente
                </Button>
              </div>
            )}

            {/* Info message if not auto-detected */}
            {!autoDetected && !windowsManual && !error && (
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex gap-2">
                  <Info className="size-4" />
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Cursor IDE não detectado. Por favor, cole seus tokens manualmente.
                  </p>
                </div>
              </div>
            )}

            {/* Access Token Input */}
            <div>
              <Label className="block mb-2">
                Token de Acesso <span className="text-red-500">*</span>
              </Label>
              <Textarea
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="O token de acesso será preenchido automaticamente..."
                rows={3}
                className="font-mono resize-none"
              />
            </div>

            {/* Machine ID Input */}
            <div>
              <Label className="block mb-2">
                ID da Máquina <span className="text-red-500">*</span>
              </Label>
              <Input
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
                placeholder="O ID da máquina será preenchido automaticamente..."
                className="font-mono text-sm"
              />
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                onClick={handleImportToken}
                fullWidth
                disabled={importing || !accessToken.trim() || !machineId.trim()}
              >
                {importing ? "Importando..." : "Importar Token"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancelar
              </Button>
            </div>
          </>
        )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
