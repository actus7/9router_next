export type CloudToolStartup = {
  configEnvVar: string;
  configPath: string;
  runArgs: string[];
};

export type CloudToolEnvInput = {
  gatewayToken: string;
  gatewayApiUrl: string;
  gatewayApiKey: string;
  model: string;
  provider: string;
  serviceUrl: string;
  allowedOrigins?: string[];
};

export type CloudToolInfo = {
  allowedOrigins: string[];
  controlUiUrl: string;
  healthUrl: string;
  readyUrl: string;
  webSocketUrl: string;
  model: string;
  provider: string;
};

export type CloudToolManifest = {
  id: string;
  name: string;
  icon: string;
  image: string;
  port: number;
  startup: CloudToolStartup;
  buildEnv: (input: CloudToolEnvInput) => Array<{ key: string; value: string }>;
  buildInfo: (input: CloudToolEnvInput) => CloudToolInfo;
};
