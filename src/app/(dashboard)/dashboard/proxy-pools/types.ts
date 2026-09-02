export interface ProxyPool {
  id: string;
  name: string;
  proxyUrl: string;
  noProxy?: string;
  isActive?: boolean;
  strictProxy?: boolean;
  testStatus?: string;
  lastTestedAt?: string;
  lastError?: string;
  boundConnectionCount?: number;
  type?: string;
}

export interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
}

export function getStatusVariant(status?: string): "secondary" | "success" | "destructive" {
  if (status === "active") return "success";
  if (status === "error") return "destructive";
  return "secondary";
}

export function formatDateTime(value?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

export function normalizeFormData(data?: Partial<ProxyPool>) {
  return {
    name: data?.name || "",
    proxyUrl: data?.proxyUrl || "",
    noProxy: data?.noProxy || "",
    isActive: data?.isActive !== false,
    strictProxy: data?.strictProxy === true,
  };
}
