"use client";

import { Badge } from "@/components/ui/badge";
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
import { RefreshCw, Trash2, ExternalLink } from "lucide-react";

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

const STATUS_LABEL: Record<Deployment["status"], string> = {
  provisioning: "Provisionando",
  healthy: "Ativo",
  failed: "Falhou",
  deleting: "Removendo",
};

const STATUS_VARIANT: Record<Deployment["status"], "default" | "secondary" | "destructive"> = {
  provisioning: "secondary",
  healthy: "default",
  failed: "destructive",
  deleting: "secondary",
};

export default function DeploymentCard({ deployment, toolName, onRefresh, onDelete }: DeploymentCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface/40 p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{toolName} · {deployment.provider}</span>
        <Badge variant={STATUS_VARIANT[deployment.status]}>{STATUS_LABEL[deployment.status]}</Badge>
      </div>
      {deployment.publicUrl && (
        <a href={deployment.publicUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-text-muted hover:text-text">
          {deployment.publicUrl}
          <ExternalLink className="size-3" />
        </a>
      )}
      {deployment.error && <p className="text-xs text-destructive-foreground">{deployment.error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onRefresh(deployment.id)}>
          <RefreshCw className="size-3.5" /> Atualizar
        </Button>
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
            <Trash2 data-icon="inline-start" className="size-3.5" /> Apagar
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apagar este ambiente?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação remove permanentemente o serviço na nuvem e não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void onDelete(deployment.id)}>
                Apagar ambiente
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
