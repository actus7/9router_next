export interface QuotaEntry {
  name: string;
  modelKey?: string;
  used: number;
  total: number;
  remaining?: number;
  remainingPercentage?: number;
  resetAt?: string | null;
  recurring?: boolean;
  unit?: string;
  message?: string;
}

export interface QuotaData {
  quotas: QuotaEntry[];
  plan?: string | null;
  message?: string | null;
  raw?: Record<string, unknown>;
}

export interface Connection {
  id: string;
  provider: string;
  name?: string;
  email?: string;
  displayName?: string;
  isActive?: boolean;
  authType?: string;
  testStatus?: string;
  providerSpecificData?: Record<string, unknown>;
  usageOnly?: boolean;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Totals {
  eligibleConnections: number;
  providerFilteredConnections: number;
}

export interface EmptyState {
  icon: string;
  title: string;
  description: string;
}
