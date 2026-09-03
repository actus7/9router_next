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
  cached_tokens?: number;
}

export interface MessageTiming {
  /** Time from request start to the first streamed token, in milliseconds. */
  ttftMs: number;
  /** Total time from request start to stream completion, in milliseconds. */
  totalMs: number;
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
  /** Model's reasoning/thinking trace for this turn, when the provider exposes one. */
  reasoning?: string;
  feedback?: "up" | "down" | null;
  tokenUsage?: TokenUsage;
  timing?: MessageTiming;
  modelId?: string;
  modelName?: string;
  providerId?: string;
  providerName?: string;
  responseSource?: "synapse" | null;
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
  /** Per-session plugin composition, resolved from a built-in agent preset. */
  agentPresetId?: string;
  /** Explicit enablement changes layered over the selected preset. */
  pluginOverrides?: Record<string, boolean>;
  /** Per-session skill enablement layered over global skill catalog. */
  skillOverrides?: Record<string, boolean>;
  /** Runtime options managed from Plugin configuration. */
  pluginSettings?: HarnessPluginSettings;
  /** Remote, unauthenticated MCP servers composed into this chat session. */
  mcpServers?: HarnessMcpServer[];
  isArchived?: boolean;
  messages: ChatMessage[];
}

export interface HarnessPluginSettings {
  maxToolSteps?: number;
  maxSubagentCalls?: number;
  webSearchMaxResults?: number;
  webFetchMaxCharacters?: number;
}

export interface HarnessMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  runtimeName: string;
  /** Individually disables this tool without removing it from the server's discovered list. Defaults to true when absent. */
  enabled?: boolean;
}

export interface HarnessMcpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  tools: HarnessMcpTool[];
  validatedAt: string;
  /** Built-in servers (e.g. Context7, GitHub) can be disabled but not removed from the session. */
  builtin?: boolean;
  /** Optional bearer token, sent as `Authorization: Bearer <token>` on every request to this server. */
  authToken?: string;
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
