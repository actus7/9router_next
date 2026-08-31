import type { Connection, QuotaData, QuotaEntry } from "./utils";

export interface ResetConfirmState {
  connection: Connection;
  resetCreditCount: number;
}

export interface CreditEntry {
  status?: string;
  grantedAt?: string;
  expiresAt?: string;
}

export interface ResetCreditsData {
  credits?: CreditEntry[];
  availableCount?: number;
}

export interface ResetCreditsState {
  connection: Connection;
  loading: boolean;
  error: string | null;
  data: ResetCreditsData | null;
}

export interface UseConnectionsReturn {
  connections: Connection[];
  setConnections: React.Dispatch<React.SetStateAction<Connection[]>>;
  providerOptions: string[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  totals: {
    eligibleConnections: number;
    providerFilteredConnections: number;
  };
  connectionsLoading: boolean;
  setConnectionsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  pageSize: number;
  setPageSize: React.Dispatch<React.SetStateAction<number>>;
  customPageSizeInput: string;
  setCustomPageSizeInput: React.Dispatch<React.SetStateAction<string>>;
  providerFilter: string;
  setProviderFilter: React.Dispatch<React.SetStateAction<string>>;
  accountFilter: string;
  setAccountFilter: React.Dispatch<React.SetStateAction<string>>;
  providerMenuOpen: boolean;
  setProviderMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  fetchConnections: (targetPage?: number) => Promise<Connection[]>;
}

export interface UseQuotaDataReturn {
  quotaData: Record<string, QuotaData>;
  setQuotaData: React.Dispatch<React.SetStateAction<Record<string, QuotaData>>>;
  loading: Record<string, boolean>;
  setLoading: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  errors: Record<string, string | null>;
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  lastUpdated: Date | null;
  setLastUpdated: React.Dispatch<React.SetStateAction<Date | null>>;
  refreshingAll: boolean;
  countdown: number;
  autoRefresh: boolean;
  setAutoRefresh: React.Dispatch<React.SetStateAction<boolean>>;
  hasHydratedAutoRefresh: boolean;
  expiringFirst: boolean;
  setExpiringFirst: React.Dispatch<React.SetStateAction<boolean>>;
  quotaSortMode: string;
  setQuotaSortMode: React.Dispatch<React.SetStateAction<string>>;
  fetchQuota: (connectionId: string, provider: string, opts?: { force?: boolean }) => Promise<void>;
  refreshProvider: (connectionId: string, provider: string) => Promise<void>;
  refreshAll: (force?: boolean) => Promise<void>;
}

export interface UseConnectionActionsReturn {
  deletingId: string | null;
  setDeletingId: React.Dispatch<React.SetStateAction<string | null>>;
  togglingId: string | null;
  setTogglingId: React.Dispatch<React.SetStateAction<string | null>>;
  showEditModal: boolean;
  setShowEditModal: React.Dispatch<React.SetStateAction<boolean>>;
  selectedConnection: Connection | null;
  setSelectedConnection: React.Dispatch<React.SetStateAction<Connection | null>>;
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  pendingDeleteId: string | null;
  setPendingDeleteId: React.Dispatch<React.SetStateAction<string | null>>;
  proxyPools: Array<{ id: string; name: string }>;
  bulkToggling: boolean;
  handleDeleteConnection: (id: string) => Promise<void>;
  handleToggleConnectionActive: (id: string, isActive: boolean) => Promise<void>;
  handleUpdateConnection: (formData: Record<string, unknown>) => Promise<void>;
  bulkSetActive: (targetIds: string[], isActive: boolean) => Promise<void>;
}

export interface UseCodexResetReturn {
  resettingLimitId: string | null;
  resetConfirmState: ResetConfirmState | null;
  setResetConfirmState: React.Dispatch<React.SetStateAction<ResetConfirmState | null>>;
  resetCreditsState: ResetCreditsState | null;
  setResetCreditsState: React.Dispatch<React.SetStateAction<ResetCreditsState | null>>;
  handleResetCodexLimit: (connectionId: string, provider: string) => Promise<void>;
  handleViewCodexResetCredits: (connection: Connection) => Promise<void>;
}

export interface UseSettingsReturn {
  autoPingMaps: Record<string, Record<string, boolean>>;
  quotaVisibility: Record<string, { hidden?: string[] }>;
  toggleAutoPing: (connectionId: string, provider: string, on: boolean) => Promise<void>;
  handleHideQuota: (provider: string, quota: QuotaEntry) => void;
  handleShowQuota: (provider: string, quota: QuotaEntry) => void;
}

export type { Connection, QuotaData, QuotaEntry } from "./utils";
