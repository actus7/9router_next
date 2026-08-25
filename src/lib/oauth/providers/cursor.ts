import { CURSOR_CONFIG } from "../constants/oauth";

interface ProviderConfig {
  [key: string]: unknown;
}

interface MappedTokens {
  accessToken: string;
  refreshToken: null;
  expiresIn: number;
  providerSpecificData: {
    machineId: string;
    authMethod: string;
  };
}

const cursor = {
  config: CURSOR_CONFIG as ProviderConfig,
  flowType: "import_token",
  mapTokens: (tokens: Record<string, unknown>): MappedTokens => ({
    accessToken: tokens.accessToken as string,
    refreshToken: null,
    expiresIn: (tokens.expiresIn as number) || 86400,
    providerSpecificData: {
      machineId: tokens.machineId as string,
      authMethod: "imported",
    },
  }),
};

export default cursor;
