"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getDefaultPricing, formatCost } from "@/lib/open-sse/providers/pricing";
import Button from "@/shared/components/Button";
import { Input } from "@/components/ui/input";

interface PricingData {
  [provider: string]: {
    [model: string]: {
      input?: number;
      output?: number;
      cached?: number;
      reasoning?: number;
      cache_creation?: number;
    };
  };
}

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
}

export default function PricingModal({ isOpen, onClose, onSave }: PricingModalProps) {
  const [pricingData, setPricingData] = useState<PricingData>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      loadPricing();
    }
  }, [isOpen]);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing");
      if (response.ok) {
        const data = await response.json();
        setPricingData(data);
      } else {
        const defaults = getDefaultPricing();
        setPricingData(defaults);
      }
    } catch (error) {
      console.error("Failed to load pricing:", error);
      const defaults = getDefaultPricing();
      setPricingData(defaults);
    } finally {
      setLoading(false);
    }
  };

  const handlePricingChange = (provider: string, model: string, field: string, value: string) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) return;

    setPricingData(prev => {
      const newData = { ...prev };
      if (!newData[provider]) newData[provider] = {};
      if (!newData[provider][model]) newData[provider][model] = {};
      (newData[provider][model] as Record<string, number>)[field] = numValue;
      return newData;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pricingData)
      });

      if (response.ok) {
        onSave?.();
        onClose();
      } else {
        const error = await response.json();
        alert(`Failed to save pricing: ${error.error}`);
      }
    } catch (error) {
      console.error("Failed to save pricing:", error);
      alert("Failed to save pricing");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset all pricing to defaults? This cannot be undone.")) return;

    try {
      const response = await fetch("/api/pricing", { method: "DELETE" });
      if (response.ok) {
        const defaults = getDefaultPricing();
        setPricingData(defaults);
      }
    } catch (error) {
      console.error("Failed to reset pricing:", error);
      alert("Failed to reset pricing");
    }
  };

  const allProviders = Object.keys(pricingData).sort();
  const pricingFields = ["input", "output", "cached", "reasoning", "cache_creation"];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p-0 gap-0 overflow-hidden sm:max-w-6xl max-h-[90vh] flex flex-col">
        <DialogTitle className="sr-only">Pricing Configuration</DialogTitle>

        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-xl font-semibold">Pricing Configuration</h2>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="text-center py-8 text-text-muted">Loading pricing data...</div>
          ) : (
            <div className="space-y-6">
              {/* Instructions */}
              <div className="bg-bg-subtle border border-border rounded-lg p-3 text-sm">
                <p className="font-medium mb-1">Pricing Rates Format</p>
                <p className="text-text-muted">
                  All rates are in <strong>dollars per million tokens</strong> ($/1M tokens).
                  Example: Input rate of 2.50 means $2.50 per 1,000,000 input tokens.
                </p>
              </div>

              {/* Pricing Tables */}
              {allProviders.map(provider => {
                const models = Object.keys(pricingData[provider]).sort();
                return (
                  <div key={provider} className="border border-border rounded-lg overflow-hidden">
                    <div className="bg-bg-subtle px-4 py-2 font-semibold text-sm">
                      {provider.toUpperCase()}
                    </div>
                      <Table>
                        <TableHeader className="bg-bg-hover text-text-muted uppercase text-xs">
                          <TableRow>
                            <TableHead className="px-3 py-2 text-left">Model</TableHead>
                            <TableHead className="px-3 py-2 text-right">Input</TableHead>
                            <TableHead className="px-3 py-2 text-right">Output</TableHead>
                            <TableHead className="px-3 py-2 text-right">Cached</TableHead>
                            <TableHead className="px-3 py-2 text-right">Reasoning</TableHead>
                            <TableHead className="px-3 py-2 text-right">Cache Creation</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {models.map(model => (
                            <TableRow key={model} className="hover:bg-bg-subtle/50">
                              <TableCell className="px-3 py-2 font-medium">{model}</TableCell>
                              {pricingFields.map(field => (
                                <TableCell key={field} className="px-3 py-2">
                                  <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={pricingData[provider][model]?.[field as keyof typeof pricingData[string][string]] || 0}
                                    onChange={(e) => handlePricingChange(provider, model, field, e.target.value)}
                                    className="w-20 px-2 py-1 text-right"
                                  />
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                  </div>
                );
              })}

              {allProviders.length === 0 && (
                <div className="text-center py-8 text-text-muted">
                  No pricing data available
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="px-4 py-2 text-sm text-red-500 hover:bg-red-500/10 border border-red-500/20"
            disabled={saving}
          >
            Reset to Defaults
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="px-4 py-2 text-sm"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              className="px-4 py-2 text-sm"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
