"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RefreshCw, Trash2, ExternalLink, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

interface Deployment {
  id: string;
  provider: string;
  toolId: string;
  status: "provisioning" | "healthy" | "failed" | "deleting";
  publicUrl: string | null;
  error: string | null;
}

interface DeploymentCardProps {
  deployment: Deployment;
  toolName: string;
  onRefresh: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const STATUS_CONFIG: Record<Deployment["status"], { label: string; icon: React.ReactNode; color: string }> = {
  provisioning: {
    label: "Provisionando",
    icon: <Loader2 className="size-4 animate-spin" />,
    color: "text-warning",
  },
  healthy: {
    label: "Ativo",
    icon: <CheckCircle2 className="size-4" />,
    color: "text-success",
  },
  failed: {
    label: "Falhou",
    icon: <AlertCircle className="size-4" />,
    color: "text-destructive",
  },
  deleting: {
    label: "Removendo",
    icon: <Loader2 className="size-4 animate-spin" />,
    color: "text-text-muted",
  },
};

export default function DeploymentCard({ deployment, toolName, onRefresh, onDelete }: DeploymentCardProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const status = STATUS_CONFIG[deployment.status];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh(deployment.id);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface/40 p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Left: Info */}
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="font-medium">{toolName}</h3>
            <p className="text-xs text-text-muted capitalize">{deployment.provider} • {deployment.id.slice(0, 8)}</p>
          </div>

          <div className="flex items-center gap-2">
            <div className={status.color}>
              {status.icon}
            </div>
            <span className="text-sm font-medium">{status.label}</span>
          </div>

          {deployment.publicUrl && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-text-muted mb-2">URL de acesso</p>
              <a
                href={deployment.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-info hover:underline break-all"
              >
                <ExternalLink className="size-3.5 flex-shrink-0" />
                {deployment.publicUrl}
              </a>
            </div>
          )}

          {deployment.error && (
            <div className="p-3 rounded-sm bg-destructive/10 border border-destructive/20">
              <p className="text-xs font-medium text-destructive-foreground flex items-start gap-2">
                <AlertCircle className="size-3.5 mt-0.5 flex-shrink-0" />
                {deployment.error}
              </p>
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex flex-col gap-2 justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing || deployment.status === "deleting"}
            className="w-full justify-center"
          >
            {isRefreshing ? (
              <>
                <Loader2 className="size-3.5 mr-2 animate-spin" />
                Atualizando...
              </>
            ) : (
              <>
                <RefreshCw className="size-3.5 mr-2" />
                Atualizar
              </>
            )}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deployment.status === "deleting"}
                  className="justify-center w-full"
                />
              }
            >
              <Trash2 className="size-3.5 mr-2" />
              Remover
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover este ambiente?</AlertDialogTitle>
                <AlertDialogDescription>
                  Será deletado permanentemente do {deployment.provider}. Esta ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void onDelete(deployment.id)}
                >
                  Remover ambiente
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
