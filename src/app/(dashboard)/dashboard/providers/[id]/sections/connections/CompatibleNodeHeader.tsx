"use client";

import { Card } from "@/shared/components";
import { Button } from "@/components/ui/button";
import { translate } from "@/i18n/runtime";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ProviderNode } from "../../types";

interface CompatibleNodeHeaderProps {
  isAnthropicCompatible: boolean;
  providerNode: ProviderNode;
  onAddApiKey: () => void;
  onEditNode: () => void;
  onDeleteNode: () => void;
}

export default function CompatibleNodeHeader({
  isAnthropicCompatible,
  providerNode,
  onAddApiKey,
  onEditNode,
  onDeleteNode,
}: CompatibleNodeHeaderProps) {
  return (
    <Card padding="sm" className="overflow-visible">
      <div className="mb-5 flex flex-col gap-4 border-b border-border-subtle pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{isAnthropicCompatible ? "Anthropic Compatible Details" : "OpenAI Compatible Details"}</h2>
          <p className="break-all text-sm text-text-muted">
            {isAnthropicCompatible ? "Messages API" : (providerNode.apiType === "responses" ? "Responses API" : "Chat Completions")} · {(providerNode.baseUrl || "").replace(/\/$/, "")}/
            {isAnthropicCompatible ? "messages" : (providerNode.apiType === "responses" ? "responses" : "chat/completions")}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
          <Button
            icon={<Plus className="size-4" />}
            onClick={onAddApiKey}
            className="w-full sm:w-auto"
          >
            {translate("Add API Key")}
          </Button>
          <Button
            variant="secondary"
            icon={<Pencil className="size-4" />}
            onClick={onEditNode}
            className="w-full sm:w-auto"
          >
            {translate("Edit")}
          </Button>
          <Button
            variant="secondary"
            icon={<Trash2 className="size-4" />}
            onClick={onDeleteNode}
            className="w-full sm:w-auto"
          >
            {translate("Delete")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
