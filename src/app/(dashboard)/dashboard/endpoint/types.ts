export interface ApiKey {
  id: string;
  name: string;
  key: string;
  isActive: boolean;
  createdAt: string;
}

export interface StatusInfo {
  type: string;
  message: string;
}

export interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => Promise<void> | void;
}

export interface APIPageClientProps {
  machineId?: string;
}
