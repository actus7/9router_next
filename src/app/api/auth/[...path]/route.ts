import { auth } from "@/lib/auth/server";

// Neon Auth owns every /api/auth/* path now. The old siblings under this
// directory — login, logout, status, reset-password, oidc/*, saml/* — were the
// single-operator password flow and the SSO modes, and are gone.
export const { GET, POST } = auth.handler();
