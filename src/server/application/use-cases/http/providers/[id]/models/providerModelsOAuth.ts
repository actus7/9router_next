import { updateProviderCredentials } from "@/server/llm-gateway/auth";

// Generic custom resolver for OAuth providers that need refresh-on-401 + token persist.
// Receives a `fetchFn(token)` and returns parsed models or throws.
export const buildOAuthResolver = ({ refreshFn, fetchFn, parseFn, errorLabel }: {
  refreshFn: (conn: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  fetchFn: (token: string, conn: Record<string, unknown>) => Promise<Response>;
  parseFn: (data: unknown) => unknown[];
  errorLabel: string;
}) => async (connection: Record<string, unknown>): Promise<{ models?: unknown[]; error?: string; status?: number; warning?: string }> => {
  const { accessToken, refreshToken } = connection;
  if (!accessToken) {
    return { error: "No valid token found", status: 401 };
  }
  let warning: string | undefined;
  try {
    let response = await fetchFn(accessToken as string, connection);
    if (!response.ok && (response.status === 401 || response.status === 403) && refreshToken) {
      const refreshed = await refreshFn(connection);
      if (refreshed?.accessToken) {
        await updateProviderCredentials(connection.id as string, {
          accessToken: refreshed.accessToken as string,
          refreshToken: (refreshed.refreshToken as string) || (refreshToken as string),
          expiresIn: refreshed.expiresIn as number | undefined,
        });
        connection.accessToken = refreshed.accessToken;
        if (refreshed.refreshToken) connection.refreshToken = refreshed.refreshToken;
        response = await fetchFn(refreshed.accessToken as string, connection);
      }
    }
    if (response.ok) {
      const data = await response.json();
      const models = parseFn(data);
      if (models.length > 0) return { models };
    } else {
      const errorText = await response.text();
      warning = `${errorLabel}: ${response.status} ${errorText}`;
      console.log(`${errorLabel} (falling back to static):`, errorText);
    }
  } catch (error) {
    warning = `${errorLabel}: ${(error as Error).message}`;
    console.error(`${errorLabel} (falling back to static):`, (error as Error).message);
  }
  return { models: [], warning };
};
