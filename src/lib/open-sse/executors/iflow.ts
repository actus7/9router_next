import crypto from "crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import type { Credentials } from "../services/types";

/**
 * IFlowExecutor - Executor for iFlow API with HMAC-SHA256 signature
 */
export class IFlowExecutor extends BaseExecutor {
  constructor() {
    super("iflow", PROVIDERS.iflow);
  }

  /**
   * Generate UUID v4
   * @returns {string} UUID v4 string
   */
  generateUUID() {
    return crypto.randomUUID();
  }

  /**
   * Create iFlow signature using HMAC-SHA256
   */
  createIFlowSignature(userAgent: string, sessionID: string, timestamp: number, apiKey: string) {
    if (!apiKey) return "";
    const payload = `${userAgent}:${sessionID}:${timestamp}`;
    const hmac = crypto.createHmac("sha256", apiKey);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  /**
   * Build headers with iFlow-specific signature
   */
  buildHeaders(credentials: Credentials, stream = true) {
    // Generate session ID and timestamp
    const sessionID = `session-${this.generateUUID()}`;
    const timestamp = Date.now();

    // Get user agent from config
    const userAgent = ((this.config.headers as Record<string, string>)?.["User-Agent"] as string) || "iFlow-Cli";

    // Get API key (prefer apiKey, fallback to accessToken)
    const apiKey = credentials.apiKey || credentials.accessToken || "";

    // Create signature
    const signature = this.createIFlowSignature(userAgent, sessionID, timestamp, apiKey);

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.config.headers as Record<string, string>),
      "session-id": sessionID,
      "x-iflow-timestamp": timestamp.toString(),
      "x-iflow-signature": signature
    };

    // Add authorization
    if (credentials.apiKey) {
      headers["Authorization"] = `Bearer ${credentials.apiKey}`;
    }

    // Add streaming header
    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  /**
   * Build URL for iFlow API
   */
  buildUrl(_model: string, _stream: boolean, _urlIndex = 0, _credentials: Credentials | null = null) {
    return this.config.baseUrl as string;
  }

  /**
   * Transform request body - inject stream_options for usage data
   */
  transformRequest(model: string, body: Record<string, unknown>, stream: boolean, _credentials: Credentials) {
    // Inject stream_options for streaming requests to get usage data
    if (stream && body.messages && !body.stream_options) {
      body.stream_options = { include_usage: true };
    }
    return body;
  }
}

export default IFlowExecutor;
