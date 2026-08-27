"use client";

import { useParams, notFound, useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { Card, Button, AddCustomEmbeddingModal, NoAuthProxyCard, ProviderInfoCard, ConfirmModal } from "@/shared/components";
import { Badge } from "@/components/ui/badge";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import ConnectionsCard from "@/app/(dashboard)/dashboard/providers/components/ConnectionsCard";
import ModelsCard from "@/app/(dashboard)/dashboard/providers/components/ModelsCard";
import { KIND_EXAMPLE_CONFIG } from "./components/exampleShared";
import { EmbeddingExampleCard } from "./components/EmbeddingExampleCard";
import { TtsExampleCard } from "./components/TtsExampleCard";
import { GenericExampleCard } from "./components/GenericExampleCard";
import { SttExampleCard } from "./components/SttExampleCard";
import { ArrowLeft, ExternalLink, Info, Pencil, Trash2, TriangleAlert } from "lucide-react";

interface CustomNode {
  id: string;
  name?: string;
  type?: string;
  prefix?: string;
}

interface MediaProviderDetailClientProps {
  initialNodes: CustomNode[];
}

// MediaProviderDetailClient
export default function MediaProviderDetailClient({ initialNodes }: MediaProviderDetailClientProps) {
  const { kind, id } = useParams();
  const router = useRouter();
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k: { id: string }) => k.id === kind);
  const isCustom = isCustomEmbeddingProvider(id as string) && kind === "embedding";

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteCustom = async () => {
    try {
      const res = await fetch(`/api/provider-nodes/${id}`, { method: "DELETE" });
      if (res.ok) router.push(`/dashboard/media-providers/${kind}`);
    } catch (error) {
      console.error("Error deleting custom embedding node:", error);
    }
  };

  // For custom embedding nodes, find the matching node from server-provided data
  const initialCustomNode = isCustom
    ? initialNodes.find((n) => n.id === id) || null
    : null;

  const [customNode, setCustomNode] = useState<CustomNode | null>(initialCustomNode);
  const [showEditModal, setShowEditModal] = useState(false);

  if (!kindConfig) return notFound();

  const builtInProvider = AI_PROVIDERS[id as string];

  // For custom embedding nodes, build a synthetic provider object
  const provider = isCustom
    ? (customNode ? { id: id as string, name: customNode.name || "Custom Embedding", color: "#6366F1", textIcon: "CE" } : null)
    : builtInProvider;

  if (!isCustom && !builtInProvider) return notFound();
  if (isCustom && !customNode) return notFound();

  const kinds = isCustom ? ["embedding"] : (provider!.serviceKinds ?? ["llm"]);
  if (!isCustom && !kinds.includes(kind as string)) return notFound();

  return (
    <div className="flex flex-col gap-8">
      {/* Back */}
      <div>
        <Link
          href={`/dashboard/media-providers/${kind}`}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <ArrowLeft className="size-4" />
          {kindConfig.label}
        </Link>

        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="size-12 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${provider!.color}15` }}>
            <ProviderIcon
              src={`/providers/${provider!.id}.png`}
              alt={provider!.name}
              size={48}
              className="object-contain rounded-lg max-w-[48px] max-h-[48px]"
              fallbackText={provider!.textIcon || provider!.id.slice(0, 2).toUpperCase()}
              fallbackColor={provider!.color}
            />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">{provider!.name}</h1>
              {!isCustom && (provider as Record<string, unknown>)?.notice && ((provider as Record<string, unknown>).notice as Record<string, unknown>)?.apiKeyUrl && (
                <a
                  href={((provider as Record<string, unknown>).notice as Record<string, string>).apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="size-4" />
                  Get API Key
                </a>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {isCustom && <Badge variant="secondary" >Custom · {customNode?.prefix}</Badge>}
              {kinds.map((k) => (
                <Badge key={k} variant={k === kind ? "default" : "secondary"}>
                  {k.toUpperCase()}
                </Badge>
              ))}
            </div>
          </div>
          {isCustom && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setShowEditModal(true)}>
                Edit
              </Button>
              <Button variant="secondary" icon={<Trash2 className="size-4" />} onClick={() => setShowDeleteConfirm(true)}>
                Delete
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Kind-specific notice (e.g. codex/image requires Plus) */}
      {!isCustom && (provider as Record<string, unknown>)?.kindNotice && ((provider as Record<string, unknown>).kindNotice as Record<string, string>)?.[kind as string] && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-5" />
          <p className="text-sm">{((provider as Record<string, unknown>).kindNotice as Record<string, string>)[kind as string]}</p>
        </div>
      )}

      {/* Provider notice text (only when there's actual text content) */}
      {!isCustom && (provider as Record<string, unknown>)?.notice && ((provider as Record<string, unknown>).notice as Record<string, string>)?.text && !(provider as Record<string, unknown>)?.deprecated && (
        <div className="flex flex-col gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 sm:flex-row sm:items-center">
          <Info className="size-4" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-blue-600 dark:text-blue-400">{((provider as Record<string, unknown>).notice as Record<string, string>).text}</p>
          {((provider as Record<string, unknown>).notice as Record<string, string>)?.apiKeyUrl && (
            <a
              href={((provider as Record<string, unknown>).notice as Record<string, string>).apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex justify-center rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 sm:py-0.5"
            >
              Get API Key →
            </a>
          )}
        </div>
      )}

      {/* Connections */}
      {!isCustom && (provider as Record<string, unknown>)?.noAuth ? (
        <NoAuthProxyCard providerId={id as string} />
      ) : (
        <ConnectionsCard providerId={id as string} isOAuth={false} />
      )}

      {/* Models - hidden for tts/webSearch/webFetch (provider IS the model); custom uses prefix as alias */}
      {kind !== "tts" && kind !== "webSearch" && kind !== "webFetch" && (
        <ModelsCard
          providerId={id as string}
          kindFilter={kind as string}
          providerAliasOverride={isCustom ? customNode?.prefix : undefined}
        />
      )}

      {/* Provider Info — config-driven, supports searchConfig, fetchConfig, ttsConfig, embeddingConfig, searchViaChat */}
      {!isCustom && ((provider as Record<string, unknown>)?.searchConfig || (provider as Record<string, unknown>)?.fetchConfig || (provider as Record<string, unknown>)?.ttsConfig || (provider as Record<string, unknown>)?.sttConfig || (provider as Record<string, unknown>)?.embeddingConfig || (provider as Record<string, unknown>)?.searchViaChat) && (
        <ProviderInfoCard
          config={
            kind === "webFetch" ? (provider as Record<string, unknown>).fetchConfig as Record<string, unknown>
              : kind === "tts" ? (provider as Record<string, unknown>).ttsConfig as Record<string, unknown>
              : kind === "stt" ? (provider as Record<string, unknown>).sttConfig as Record<string, unknown>
              : kind === "embedding" ? (provider as Record<string, unknown>).embeddingConfig as Record<string, unknown>
              : ((provider as Record<string, unknown>).searchConfig as Record<string, unknown>) || { mode: "chat-completions", defaultModel: ((provider as Record<string, unknown>).searchViaChat as Record<string, unknown>)?.defaultModel, pricingUrl: ((provider as Record<string, unknown>).searchViaChat as Record<string, unknown>)?.pricingUrl, freeTier: ((provider as Record<string, unknown>).searchViaChat as Record<string, unknown>)?.freeTier }
          }
          provider={provider}
          title={`${kindConfig.label} Config`}
        />
      )}

      {/* Example — per kind */}
      {kind === "embedding" && (
        <EmbeddingExampleCard providerId={id as string} customAlias={customNode?.prefix} />
      )}
      {kind === "tts" && <TtsExampleCard providerId={id as string} />}
      {kind === "stt" && !isCustom && <SttExampleCard providerId={id as string} />}
      {!isCustom && KIND_EXAMPLE_CONFIG[kind as string] && <GenericExampleCard providerId={id as string} kind={kind as string} />}

      {isCustom && (
        <AddCustomEmbeddingModal
          isOpen={showEditModal}
          node={customNode}
          onClose={() => setShowEditModal(false)}
          onSaved={(updated: CustomNode) => {
            setCustomNode(updated);
            setShowEditModal(false);
          }}
        />
      )}

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          handleDeleteCustom();
        }}
        title="Delete Custom Embedding"
        message="Delete this Custom Embedding node?"
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}
