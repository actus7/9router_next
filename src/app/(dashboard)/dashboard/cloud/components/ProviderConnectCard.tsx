"use client";

import { useState } from "react";
import Button from "@/shared/components/Button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

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
  connection: Connection | null;
  onConnect: (provider: string, token: string) => Promise<{ error?: string }>;
  onDisconnect: (provider: string) => Promise<void>;
}

export default function ProviderConnectCard({ provider, label, hint, connection, onConnect, onDisconnect }: ProviderConnectCardProps) {
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
    <div className="flex items-center justify-between rounded-lg border border-border bg-surface/40 px-4 py-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{label}</span>
          <Badge variant={connection ? "default" : "secondary"}>
            {connection ? "Conectado" : "Desconectado"}
          </Badge>
        </div>
        <p className="text-xs text-text-muted">
          {connection?.externalUserEmail || connection?.externalOrgName || hint}
        </p>
      </div>
      {connection ? (
        <Button variant="outline" size="sm" onClick={() => onDisconnect(provider)}>Desconectar</Button>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button variant="outline" size="sm" />}>
            Conectar
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Conectar {label}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2 py-2">
              <Input
                type="password"
                placeholder="API token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={handleConnect} disabled={!token.trim() || isSubmitting}>
                {isSubmitting ? "Validando..." : "Conectar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
