import { DefaultExecutor } from "./default";
import type { Credentials } from "../services/types";

export class AzureExecutor extends DefaultExecutor {
  constructor() {
    super("azure");
  }

  buildUrl(model: string, stream: boolean, _urlIndex = 0, credentials: Credentials | null = null) {
    const azureEndpoint = credentials?.providerSpecificData?.azureEndpoint
      || process.env.AZURE_ENDPOINT
      || "https://api.openai.com";

    const apiVersion = credentials?.providerSpecificData?.apiVersion
      || process.env.AZURE_API_VERSION
      || "2024-10-01-preview";

    const deployment = credentials?.providerSpecificData?.deployment
      || model
      || process.env.AZURE_DEPLOYMENT
      || "gpt-4";

    const endpoint = (azureEndpoint as string).replace(/\/$/, "");
    return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  }

  buildHeaders(credentials: Credentials, stream = true) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers
    };

    const apiKey = credentials?.apiKey
      || credentials?.accessToken
      || process.env.OPENAI_API_KEY;

    if (apiKey) {
      headers["api-key"] = apiKey;
    }

    const organization = credentials?.providerSpecificData?.organization
      || process.env.AZURE_ORGANIZATION;

    if (organization) {
      headers["OpenAI-Organization"] = organization as string;
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  transformRequest(model: string, body: Record<string, unknown>, _stream: boolean, _credentials: Credentials) {
    return body;
  }
}
