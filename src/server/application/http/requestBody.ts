import type { NextRequest } from "next/server";

export class HttpValidationError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status = 400, code: string | null = null) {
    super(message);
    this.name = "HttpValidationError";
    this.status = status;
    this.code = code;
  }
}

export async function parseJsonBody<T extends Record<string, unknown>>(
  request: NextRequest,
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpValidationError("Invalid JSON body", 400, "INVALID_JSON");
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpValidationError("Request body must be a JSON object", 400, "INVALID_JSON");
  }

  return body as T;
}

export function requireStringField(
  body: Record<string, unknown>,
  field: string,
  options: { trim?: boolean; minLength?: number } = {},
): string {
  const raw = body[field];
  if (typeof raw !== "string") {
    throw new HttpValidationError(`${field} is required`, 400, "VALIDATION_ERROR");
  }
  const value = options.trim === false ? raw : raw.trim();
  if (options.minLength !== undefined && value.length < options.minLength) {
    throw new HttpValidationError(`${field} is required`, 400, "VALIDATION_ERROR");
  }
  if (!value) {
    throw new HttpValidationError(`${field} is required`, 400, "VALIDATION_ERROR");
  }
  return value;
}

export function optionalStringField(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const raw = body[field];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") {
    throw new HttpValidationError(`${field} must be a string`, 400, "VALIDATION_ERROR");
  }
  return raw.trim();
}
