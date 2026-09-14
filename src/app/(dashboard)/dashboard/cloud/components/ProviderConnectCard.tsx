"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface Connection {
  id: string;
  provider: string;
  externalUserEmail: string | null;
  externalOrgName: string | null;
}

interface ProviderConnectCardProps {
  provider: "render" | "railway";
  label: string;
  hint: string;
  description?: string;
  connection: Connection | null;
  onConnect: (provider: string, token: string) => Promise<{ error?: string }>;
  onDisconnect: (provider: string) => Promise<void>;
}

export default function ProviderConnectCard({ provider, label, hint, description, connection, onConnect, onDisconnect }: ProviderConnectCardProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConnect = async () => {
    setIsSubmitting(true);
    setError(null);
    const result = await onConnect(provider, token.trim());
    setIsSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setToken("");
    setOpen(false);
  };

  return (
    <div className={`flex flex-col gap-3 rounded-lg border p-4 transition-colors ${
      connection
        ? "border-accent/30 bg-accent/5"
        : "border-border bg-surface/40"
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            {connection ? (
              <CheckCircle2 className="size-4 text-accent" />
            ) : (
              <AlertCircle className="size-4 text-text-muted opacity-50" />
            )}
            <h3 className="font-semibold text-sm">{label}</h3>
          </div>
          {description && (
            <p className="text-xs text-text-muted mb-1">{description}</p>
          )}
          {connection ? (
            <p className="text-xs text-accent font-medium">
              {connection.externalUserEmail || connection.externalOrgName || "Conectado"}
            </p>
          ) : (
            <p className="text-xs text-text-muted">{hint}</p>
          )}
        </div>
      </div>

      {connection ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDisconnect(provider)}
          className="w-full"
        >
          Desconectar
        </Button>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button size="sm" className="w-full" />}>
            Conectar
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Conectar {label}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">Token da API</label>
                  {provider === "render" && (
                    <a
                      href="https://dashboard.render.com/api-tokens"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent hover:underline"
                    >
                      Gerar novo token →
                    </a>
                  )}
                  {provider === "railway" && (
                    <a
                      href="https://railway.app/project/_/settings/tokens"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent hover:underline"
                    >
                      Gerar novo token →
                    </a>
                  )}
                </div>
                <Input
                  type="password"
                  placeholder="Cole o token aqui"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 rounded-sm bg-destructive/10 p-3">
                  <AlertCircle className="size-4 text-destructive mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-destructive-foreground">{error}</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleConnect} disabled={!token.trim() || isSubmitting}>
                {isSubmitting && <Loader2 className="size-4 mr-2 animate-spin" />}
                {isSubmitting ? "Conectando..." : "Conectar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
