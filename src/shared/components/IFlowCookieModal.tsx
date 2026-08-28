"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button, Input } from "@/shared/components";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

interface IFlowCookieModalProps {
  isOpen: boolean;
  onSuccess?: () => void;
  onClose?: () => void;
}

/**
 * iFlow Cookie Authentication Modal
 * User pastes browser cookie to get fresh API key
 */
export default function IFlowCookieModal({ isOpen, onSuccess, onClose }: IFlowCookieModalProps) {
  const [cookie, setCookie] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  const handleSubmit = async () => {
    if (!cookie.trim()) {
      setError("Please paste your cookie");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/iflow/cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: cookie.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
        handleClose();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCookie("");
    setError(null);
    setSuccess(false);
    onClose?.();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
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
            Autenticação por Cookie iFlow
          </DialogTitle>
          <Button onClick={handleClose} aria-label="Fechar" variant="ghost" size="sm" className="p-1.5">
            <X className="size-5" />
          </Button>
        </div>
        <div className="p-6 max-h-[calc(85vh-100px)] overflow-y-auto custom-scrollbar">
          <div className="space-y-4">
        {success ? (
          <div className="text-center py-8">
            <div className="text-6xl mb-4">✅</div>
            <p className="text-lg font-medium text-text-primary">Autenticação Bem-sucedida!</p>
            <p className="text-sm text-text-muted mt-2">Chave API fresca obtida</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-sm text-text-muted">
                Para obter uma chave API fresca, cole o cookie do seu navegador de{" "}
                <a
                  href="https://platform.iflow.cn"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  platform.iflow.cn
                </a>
              </p>
              <div className="bg-surface-secondary p-3 rounded-lg text-xs space-y-2">
                <p className="font-medium text-text-primary">Como obter o cookie:</p>
                <ol className="list-decimal list-inside space-y-1 text-text-muted">
                  <li>Abra platform.iflow.cn no seu navegador</li>
                  <li>Faça login na sua conta</li>
                  <li>Abra as DevTools (F12) → Application/Storage → Cookies</li>
                  <li>Copie toda a string do cookie (deve incluir BXAuth)</li>
                  <li>Cole abaixo</li>
                </ol>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="block text-text-primary">
                String do Cookie
              </Label>
              <Textarea
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                placeholder="BXAuth=xxx; ..."
                className="resize-none"
                rows={4}
                disabled={loading}
              />
            </div>

            {error && (
              <div className="p-3 bg-error/10 border border-error/20 rounded-lg">
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={handleClose} disabled={loading} fullWidth>
                Cancelar
              </Button>
              <Button onClick={handleSubmit} loading={loading} fullWidth>
                Autenticar
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
