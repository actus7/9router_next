// Shared embedding helpers
export function bearerAuth(creds: Record<string, unknown>) {
  return { "Authorization": `Bearer ${creds.apiKey || creds.accessToken}` };
}
