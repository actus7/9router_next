"use client";

import { create } from "zustand";
import { CLIENT_STORE_TTL_MS } from "@/shared/constants/config";

interface Provider {
  _id: string;
  [key: string]: unknown;
}

interface ProviderState {
  providers: Provider[];
  loading: boolean;
  error: string | null;
  lastFetched: number;
  setProviders: (providers: Provider[]) => void;
  addProvider: (provider: Provider) => void;
  updateProvider: (id: string, updates: Partial<Provider>) => void;
  removeProvider: (id: string) => void;
  invalidate: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  fetchProviders: (options?: { force?: boolean }) => Promise<void>;
}

const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  loading: false,
  error: null,
  lastFetched: 0,

  setProviders: (providers: Provider[]) => set({ providers, lastFetched: Date.now() }),

  addProvider: (provider: Provider) =>
    set((state) => ({ providers: [provider, ...state.providers] })),

  updateProvider: (id: string, updates: Partial<Provider>) =>
    set((state) => ({
      providers: state.providers.map((p) =>
        p._id === id ? { ...p, ...updates } : p
      ),
    })),

  removeProvider: (id: string) =>
    set((state) => ({
      providers: state.providers.filter((p) => p._id !== id),
    })),

  invalidate: () => set({ lastFetched: 0 }),

  setLoading: (loading: boolean) => set({ loading }),

  setError: (error: string | null) => set({ error }),

  // Skips network when cache is fresh (< CLIENT_STORE_TTL_MS). Pass {force:true} to override.
  fetchProviders: async ({ force = false } = {}) => {
    const { lastFetched, providers } = get();
    if (!force && providers.length > 0 && Date.now() - lastFetched < CLIENT_STORE_TTL_MS) return;
    set({ loading: true, error: null });
    try {
      const response = await fetch("/api/providers");
      const data = await response.json();
      if (response.ok) {
        set({ providers: data.connections || data.providers || [], loading: false, lastFetched: Date.now() });
      } else {
        set({ error: data.error, loading: false });
      }
    } catch (error) {
      set({ error: "Failed to fetch providers", loading: false });
    }
  },
}));

export default useProviderStore;
