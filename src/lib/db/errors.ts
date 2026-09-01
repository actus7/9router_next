export type PersistenceErrorKind = "not_found" | "unavailable" | "corruption" | "unexpected";

export class PersistenceError extends Error {
  readonly kind: PersistenceErrorKind;
  readonly operation: string;

  constructor(kind: PersistenceErrorKind, operation: string, cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause ?? "unknown error");
    super(`Persistence ${kind} during ${operation}: ${detail}`, { cause });
    this.name = "PersistenceError";
    this.kind = kind;
    this.operation = operation;
  }
}

export function toPersistenceError(operation: string, cause: unknown): PersistenceError {
  if (cause instanceof PersistenceError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  const code = typeof cause === "object" && cause !== null && "code" in cause
    ? String((cause as { code?: unknown }).code ?? "")
    : "";
  const diagnostic = `${code} ${message}`.toUpperCase();

  if (/SQLITE_(BUSY|LOCKED|IOERR|CANTOPEN|FULL)|ECONN|ETIMEDOUT|ENOTFOUND/.test(diagnostic)) {
    return new PersistenceError("unavailable", operation, cause);
  }
  if (/SQLITE_(CORRUPT|NOTADB)|MALFORMED|CORRUPT/.test(diagnostic)) {
    return new PersistenceError("corruption", operation, cause);
  }
  return new PersistenceError("unexpected", operation, cause);
}

export function persistenceNotFound(operation: string, identifier: string): PersistenceError {
  return new PersistenceError("not_found", operation, new Error(identifier));
}
