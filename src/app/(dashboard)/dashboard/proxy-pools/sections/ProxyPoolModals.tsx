"use client";

import { Textarea } from "@/components/ui/textarea";
import { Button, Input, Modal, ConfirmModal } from "@/shared/components";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { translate } from "@/i18n/runtime";
import type { ProxyPool, ConfirmState } from "../types";

interface ProxyPoolModalsProps {
  // Form modal
  showFormModal: boolean;
  editingProxyPool: ProxyPool | null;
  formData: { name: string; proxyUrl: string; noProxy: string; isActive: boolean; strictProxy: boolean };
  setFormData: React.Dispatch<React.SetStateAction<{ name: string; proxyUrl: string; noProxy: string; isActive: boolean; strictProxy: boolean }>>;
  saving: boolean;
  closeFormModal: () => void;
  handleSave: () => void;
  // Batch import modal
  showBatchImportModal: boolean;
  batchImportText: string;
  setBatchImportText: (v: string) => void;
  importing: boolean;
  closeBatchImportModal: () => void;
  handleBatchImport: () => void;
  // Vercel modal
  showVercelModal: boolean;
  vercelForm: { vercelToken: string; projectName: string };
  setVercelForm: React.Dispatch<React.SetStateAction<{ vercelToken: string; projectName: string }>>;
  deploying: boolean;
  closeVercelModal: () => void;
  handleVercelDeploy: () => void;
  // Cloudflare modal
  showCloudflareModal: boolean;
  cloudflareForm: { accountId: string; apiToken: string; projectName: string };
  setCloudflareForm: React.Dispatch<React.SetStateAction<{ accountId: string; apiToken: string; projectName: string }>>;
  closeCloudflareModal: () => void;
  handleCloudflareDeploy: () => void;
  // Deno modal
  showDenoModal: boolean;
  denoForm: { denoToken: string; orgDomain: string; projectName: string };
  setDenoForm: React.Dispatch<React.SetStateAction<{ denoToken: string; orgDomain: string; projectName: string }>>;
  closeDenoModal: () => void;
  handleDenoDeploy: () => void;
  // Confirm modal
  confirmState: ConfirmState | null;
  setConfirmState: (v: ConfirmState | null) => void;
}

export default function ProxyPoolModals({
  showFormModal, editingProxyPool, formData, setFormData, saving, closeFormModal, handleSave,
  showBatchImportModal, batchImportText, setBatchImportText, importing, closeBatchImportModal, handleBatchImport,
  showVercelModal, vercelForm, setVercelForm, deploying, closeVercelModal, handleVercelDeploy,
  showCloudflareModal, cloudflareForm, setCloudflareForm, closeCloudflareModal, handleCloudflareDeploy,
  showDenoModal, denoForm, setDenoForm, closeDenoModal, handleDenoDeploy,
  confirmState, setConfirmState,
}: ProxyPoolModalsProps) {
  return (
    <>
      <Modal
        isOpen={showBatchImportModal}
        title={translate("Batch Import Proxies") || "Batch Import Proxies"}
        onClose={closeBatchImportModal}
      >
        <div className="flex flex-col gap-4">
          <div>
            <Label className="text-text-main mb-1 block">{translate("Paste Proxy List (One per line)") || "Paste Proxy List (One per line)"}</Label>
            <Textarea
              value={batchImportText}
              onChange={(e) => setBatchImportText(e.target.value)}
              placeholder={"http://user:pass@127.0.0.1:7897\n127.0.0.1:7897:user:pass"}
              className="min-h-[180px]"
            />
            <p className="text-xs text-text-muted mt-1">
              {translate("Supported formats:") || "Supported formats:"} protocol://user:pass@host:port, host:port:user:pass
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button fullWidth onClick={handleBatchImport} disabled={!batchImportText.trim() || importing}>
              {importing ? (translate("Importing...") || "Importing...") : (translate("Import") || "Import")}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeBatchImportModal} disabled={importing}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showVercelModal}
        title={translate("Deploy Vercel Relay") || "Deploy Vercel Relay"}
        onClose={closeVercelModal}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-blue-500/5 border border-blue-500/10 p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">{translate("What is Vercel Relay?") || "What is Vercel Relay?"}</p>
            <p className="text-xs text-text-muted">
              Deploys an edge relay function to Vercel. All AI provider requests will be forwarded through Vercel&apos;s edge network, masking your real IP from providers.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>Your IP is replaced by Vercel&apos;s dynamic edge IPs (hundreds of IPs across 20+ global regions)</li>
              <li>Vercel serves millions of apps — providers can&apos;t block Vercel IPs without affecting legitimate traffic</li>
              <li>Free tier: 100GB bandwidth/month, 500K edge invocations</li>
              <li>Deploy multiple relays on different accounts for more IP diversity</li>
            </ul>
          </div>
          <Input
            label="Vercel API Token"
            value={vercelForm.vercelToken}
            onChange={(e) => setVercelForm((prev) => ({ ...prev, vercelToken: e.target.value }))}
            placeholder="your-vercel-api-token"
            hint={"Token is used once for deployment and not stored. Get token →"}
            type="password"
          />
          <Input
            label="Project Name"
            value={vercelForm.projectName}
            onChange={(e) => setVercelForm((prev) => ({ ...prev, projectName: e.target.value }))}
            placeholder="my-relay"
            hint="Unique name for your Vercel project. Leave empty for auto-generated name."
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleVercelDeploy}
              disabled={!vercelForm.vercelToken.trim() || deploying}
            >
              {deploying ? (translate("Deploying...") || "Deploying...") : (translate("Deploy") || "Deploy")}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeVercelModal} disabled={deploying}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showCloudflareModal}
        title={translate("Deploy Cloudflare Relay") || "Deploy Cloudflare Relay"}
        onClose={closeCloudflareModal}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-orange-500/5 border border-orange-500/10 p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">{translate("What is Cloudflare Relay?") || "What is Cloudflare Relay?"}</p>
            <p className="text-xs text-text-muted">
              Deploys a Cloudflare Worker as a proxy relay. All AI provider requests will be forwarded through Cloudflare&apos;s global edge network.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>High performance global routing and IP masking via Cloudflare Workers</li>
              <li>Free tier: 100,000 requests per day</li>
              <li>Requires Cloudflare Account ID and a Workers API Token (Edit Workers permission)</li>
            </ul>
            <div className="mt-2 pt-2 border-t border-orange-500/10 text-xs text-text-muted">
              <p className="font-medium text-text-main mb-1">How to generate your API Token:</p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>Go to <b>My Profile</b> → <b>API Tokens</b> → <b>Create Token</b></li>
                <li>Scroll down to <b>Custom Token</b> and click <b>Get started</b></li>
                <li>Under <b>Permissions</b>: Account | Workers Scripts | Edit</li>
                <li>Under <b>Account Resources</b>: Include | Account | <i>Your Account Name</i></li>
                <li>Click <b>Continue to summary</b> → <b>Create Token</b></li>
              </ol>
            </div>
          </div>
          <Input
            label="Account ID"
            value={cloudflareForm.accountId}
            onChange={(e) => setCloudflareForm((prev) => ({ ...prev, accountId: e.target.value }))}
            placeholder="your-cloudflare-account-id"
            hint={"Found on the right side of the Cloudflare dashboard overview page."}
          />
          <Input
            label="API Token"
            value={cloudflareForm.apiToken}
            onChange={(e) => setCloudflareForm((prev) => ({ ...prev, apiToken: e.target.value }))}
            placeholder="your-cloudflare-api-token"
            hint={"Requires \"Workers Scripts: Edit\" permission. Get token →"}
            type="password"
          />
          <Input
            label="Worker Name"
            value={cloudflareForm.projectName}
            onChange={(e) => setCloudflareForm((prev) => ({ ...prev, projectName: e.target.value }))}
            placeholder="my-relay"
            hint="Unique name for your Cloudflare Worker. Leave empty for auto-generated name."
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleCloudflareDeploy}
              disabled={!cloudflareForm.accountId.trim() || !cloudflareForm.apiToken.trim() || deploying}
            >
              {deploying ? (translate("Deploying...") || "Deploying...") : (translate("Deploy Worker") || "Deploy Worker")}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeCloudflareModal} disabled={deploying}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showDenoModal}
        title={translate("Deploy Deno Relay") || "Deploy Deno Relay"}
        onClose={closeDenoModal}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 p-3 flex flex-col gap-1.5">
            <p className="text-sm text-text-main font-medium">{translate("What is Deno Relay?") || "What is Deno Relay?"}</p>
            <p className="text-xs text-text-muted">
              Deploys a relay worker to Deno Deploy&apos;s global edge network. All AI provider requests are forwarded through Deno&apos;s edge, masking your real IP.
            </p>
            <ul className="text-xs text-text-muted list-disc pl-4 space-y-0.5">
              <li>Deno Deploy v2 runs on a high-performance global edge network</li>
              <li>Free tier: 1M requests & 100GiB outbound traffic per month</li>
              <li>No per-request CPU time limits (unlike Vercel/Cloudflare)</li>
              <li>Support up to 20 active apps & 50 custom domains</li>
              <li>Deploy multiple relays for maximum IP diversity</li>
            </ul>
            <div className="mt-2 pt-2 border-t border-black/10 dark:border-white/10 text-xs text-text-muted">
              <p className="font-medium text-text-main mb-1">How to generate API token:</p>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>Go to <b>console.deno.com</b></li>
                <li>Select your <b>Organization</b> → <b>Settings</b> → <b>Organization Tokens</b></li>
                <li>Create a <b>Organization Token</b> (prefix <b>ddo_</b>)</li>
              </ol>
            </div>
          </div>
          <Input
            label="Deno Deploy API Token"
            value={denoForm.denoToken}
            onChange={(e) => setDenoForm((prev) => ({ ...prev, denoToken: e.target.value }))}
            placeholder="ddo_xxxxxxxxxxxxxxxx"
            hint={"Token is used once for deployment, not stored. Found in Organization Settings."}
            type="password"
          />
          <Input
            label="Organization Domain"
            value={denoForm.orgDomain}
            onChange={(e) => setDenoForm((prev) => ({ ...prev, orgDomain: e.target.value }))}
            placeholder="your-org.deno.net"
            hint="Organization's default domain. Your relay URL will be in the format: https://my-relay.your-org.deno.net"
          />
          <Input
            label="App Name"
            value={denoForm.projectName}
            onChange={(e) => setDenoForm((prev) => ({ ...prev, projectName: e.target.value }))}
            placeholder="deno-relay"
            hint="Unique app name. Leave empty for auto-generated name."
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleDenoDeploy}
              disabled={!denoForm.denoToken.trim() || !denoForm.orgDomain.trim() || deploying}
            >
              {deploying ? (translate("Deploying...") || "Deploying...") : (translate("Deploy Relay") || "Deploy Relay")}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeDenoModal} disabled={deploying}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showFormModal}
        title={editingProxyPool ? (translate("Edit Proxy Pool") || "Edit Proxy Pool") : (translate("Add Proxy Pool") || "Add Proxy Pool")}
        onClose={closeFormModal}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Name"
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Office Proxy"
          />
          <Input
            label="Proxy URL"
            value={formData.proxyUrl}
            onChange={(e) => setFormData((prev) => ({ ...prev, proxyUrl: e.target.value }))}
            placeholder="http://127.0.0.1:7897"
          />
          <Input
            label="No Proxy"
            value={formData.noProxy}
            onChange={(e) => setFormData((prev) => ({ ...prev, noProxy: e.target.value }))}
            placeholder="localhost,127.0.0.1,.internal"
            hint="Comma-separated hosts/domains to bypass proxy"
          />

          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-sm">Active</p>
              <p className="text-xs text-text-muted">{translate("Inactive pools are ignored by runtime resolution.") || "Inactive pools are ignored by runtime resolution."}</p>
            </div>
            <Switch
              checked={formData.isActive === true}
              onCheckedChange={() => setFormData((prev) => ({ ...prev, isActive: !prev.isActive }))}
              disabled={saving}
            />
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-sm">Strict Proxy</p>
              <p className="text-xs text-text-muted">{translate("Fail request if proxy is unreachable instead of falling back to direct.") || "Fail request if proxy is unreachable instead of falling back to direct."}</p>
            </div>
            <Switch
              checked={formData.strictProxy === true}
              onCheckedChange={() => setFormData((prev) => ({ ...prev, strictProxy: !prev.strictProxy }))}
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              onClick={handleSave}
              disabled={!formData.name.trim() || !formData.proxyUrl.trim() || saving}
            >
              {saving ? (translate("Saving...") || "Saving...") : (translate("Save") || "Save")}
            </Button>
            <Button fullWidth variant="ghost" onClick={closeFormModal} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm ?? (() => {})}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </>
  );
}
