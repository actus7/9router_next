import { SignJWT, jwtVerify, JWTPayload } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/db/repos/settingsRepo";
const DEFAULT_PASSWORD: string = "123456";

function loadJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file: string = path.join(DATA_DIR, "jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated: string = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

const SECRET: Uint8Array = new TextEncoder().encode(loadJwtSecret());

interface RequestLike {
  headers: {
    get(name: string): string | null;
  };
}

interface CookieStore {
  set(name: string, value: string, options: Record<string, unknown>): void;
  delete(name: string): void;
}

export function shouldUseSecureCookie(request?: RequestLike): boolean {
  const forceSecureCookie: boolean = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto: string | null = request?.headers?.get?.("x-forwarded-proto") ?? null;
  const isHttpsRequest: boolean = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

async function createDashboardAuthToken(claims: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ authenticated: true, ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token: string): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function setDashboardAuthCookie(
  cookieStore: CookieStore,
  request: RequestLike,
  claims: Record<string, unknown> = {}
): Promise<void> {
  const token: string = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
  });
}

export function clearDashboardAuthCookie(cookieStore: CookieStore): void {
  cookieStore.delete("auth_token");
}

// Verify the current dashboard password (re-auth for sensitive actions).
export async function verifyDashboardPassword(password: string): Promise<boolean> {
  if (typeof password !== "string" || !password) return false;
  const settings: Record<string, unknown> = await getSettings();
  const storedHash: string | undefined = settings?.password as string | undefined;
  if (storedHash) return bcrypt.compare(password, storedHash);
  const initialPassword: string = process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD;
  return password === initialPassword;
}
