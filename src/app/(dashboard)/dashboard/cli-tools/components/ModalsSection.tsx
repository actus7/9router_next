"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface CustomMcpPlugin {
  name: string;
  url: string;
  transport?: string;
  custom?: boolean;
}

interface AddMcpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (plugin: CustomMcpPlugin) => void;
}

export function AddMcpModal({ isOpen, onClose, onAdd }: AddMcpModalProps) {
  const [form, setForm] = useState<{ name: string; url: string }>({ name: "", url: "" });

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setForm({ name: "", url: "" });
      onClose();
    }
  };

  const handleAdd = () => {
    const name = form.name.trim();
    if (!name || !form.url.trim()) return;
    onAdd({ name, url: form.url.trim(), transport: "sse", custom: true });
    setForm({ name: "", url: "" });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Custom MCP</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-text-muted">Name</Label>
            <Input
              type="text"
              placeholder="my-mcp"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value.replace(/\s+/g, "-").toLowerCase() }))}
              className="px-2 py-1.5 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-text-muted">SSE URL</Label>
            <Input
              type="text"
              placeholder="https://your-mcp-server.com/sse"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              className="px-2 py-1.5 text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAdd} size="sm">Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
