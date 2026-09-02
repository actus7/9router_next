export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  size?: number;
  dataUrl: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  status?: "pending" | "running" | "done" | "error";
}

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatMessage {
  id: string;
  role: string;
  content: string | unknown;
  attachments?: ChatAttachment[];
  createdAt?: string;
  status?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  feedback?: "up" | "down" | null;
  tokenUsage?: TokenUsage;
  modelId?: string;
  modelName?: string;
  providerId?: string;
  providerName?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  mode?: "agent" | "plan";
  messages: ChatMessage[];
}

export interface SendMessageOptions {
  text: string;
  attachments?: ChatAttachment[];
  baseMessages?: ChatMessage[];
}

export interface ChatProject {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessEvent {
  sessionId: string;
  seq: number;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface NormalizedModel {
  id: string;
  requestModel: string;
  name: string;
  providerId: string;
  providerName: string;
  source: string;
  caps?: Record<string, boolean>;
  kind?: string;
}

export interface ProviderGroup {
  providerId: string;
  providerName: string;
  providerType: string;
  connections: Array<Record<string, unknown>>;
  models: NormalizedModel[];
}
