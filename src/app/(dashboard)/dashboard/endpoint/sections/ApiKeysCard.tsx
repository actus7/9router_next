"use client";

import { Card, Button } from "@/shared/components";
import { Switch } from "@/components/ui/switch";
import SecurityWarning from "../components/SecurityWarning";
import { Check, Copy, Eye, EyeOff, KeyRound, Plus, Trash2 } from "lucide-react";
import { translate } from "@/i18n/runtime";
import type { ApiKey, ConfirmState } from "../types";

interface ApiKeysCardProps {
  keys: ApiKey[];
  setShowAddModal: (v: boolean) => void;
  requireApiKey: boolean;
  handleRequireApiKey: (v: boolean) => void;
  isRemoteHost: boolean;
  visibleKeys: Set<string>;
  copied: string | null;
  copy: (text: string, id: string) => void;
  maskKey: (key: string) => string;
  toggleKeyVisibility: (keyId: string) => void;
  setConfirmState: (state: ConfirmState | null) => void;
  handleToggleKey: (id: string, isActive: boolean) => void;
  handleDeleteKey: (id: string) => void;
}

export default function ApiKeysCard({
  keys, setShowAddModal, requireApiKey, handleRequireApiKey,
  isRemoteHost, visibleKeys, copied, copy,
  maskKey, toggleKeyVisibility, setConfirmState, handleToggleKey, handleDeleteKey,
}: ApiKeysCardProps) {
  return (
    <Card id="require-api-key">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <KeyRound className="size-4" />
          API Keys
        </h2>
        <Button icon={<Plus className="size-4" />} onClick={() => setShowAddModal(true)}>
          {translate("Create Key") || "Create Key"}
        </Button>
      </div>

      <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
        <div>
          <p className="font-medium">{translate("Require API key") || "Require API key"}</p>
          <p className="text-sm text-text-muted">
            {translate("Requests without a valid key will be rejected") || "Requests without a valid key will be rejected"}
          </p>
        </div>
        <Switch
          checked={requireApiKey}
          onCheckedChange={() => handleRequireApiKey(!requireApiKey)}
        />
      </div>

      {isRemoteHost && !requireApiKey && (
        <div className="mb-4 -mt-2">
          <SecurityWarning message={translate("Endpoint is exposed without an API key.") || "Endpoint is exposed without an API key."} />
        </div>
      )}

      {keys.length === 0 ? (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
            <KeyRound className="size-8" />
          </div>
          <p className="text-text-main font-medium mb-1">{translate("No API keys yet") || "No API keys yet"}</p>
          <p className="text-sm text-text-muted mb-4">{translate("Create your first API key to get started") || "Create your first API key to get started"}</p>
          <Button icon={<Plus className="size-4" />} onClick={() => setShowAddModal(true)}>
            {translate("Create Key") || "Create Key"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col">
          {keys.map((key) => (
            <div
              key={key.id}
              className={`group flex items-center justify-between py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 ${key.isActive === false ? "opacity-60" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{key.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-xs text-text-muted font-mono">
                    {visibleKeys.has(key.id) ? key.key : maskKey(key.key)}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => toggleKeyVisibility(key.id)}
                    title={visibleKeys.has(key.id) ? "Hide key" : "Show key"}
                  >
                    {visibleKeys.has(key.id) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => copy(key.key, key.id)}
                  >
                    {copied === key.id ? <Check className="size-4" /> : <Copy className="size-4" />}
                  </Button>
                </div>
                  <p className="text-xs text-text-muted mt-1">
                    {translate("Created on") || "Created on"} {new Date(key.createdAt).toLocaleDateString()}
                  </p>
                  {key.isActive === false && (
                    <p className="text-xs text-orange-500 mt-1">{translate("Paused") || "Paused"}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  size="sm"
                  checked={key.isActive ?? true}
                  onCheckedChange={(checked) => {
                    if (key.isActive && !checked) {
                      setConfirmState({
                        title: translate("Pause API Key") || "Pause API Key",
                        message: `${translate("Pause API key") || "Pause API key"} "${key.name}"?\n\n${translate("This key will stop working immediately, but can be resumed later.") || "This key will stop working immediately, but can be resumed later."}`,
                        onConfirm: async () => {
                          setConfirmState(null);
                          handleToggleKey(key.id, checked);
                        }
                      });
                    } else {
                      handleToggleKey(key.id, checked);
                    }
                  }}
                  title={key.isActive ? "Pause key" : "Resume key"}
                />
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => handleDeleteKey(key.id)}
                  className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <Trash2 className="size-5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
