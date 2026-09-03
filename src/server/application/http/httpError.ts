import { NextResponse } from "next/server";
import { HttpValidationError } from "@/server/application/http/requestBody";

export interface HttpErrorBody {
  error: string;
  code: string | null;
}

export function serializeHttpError(
  error: unknown,
  fallbackMessage = "Internal server error",
  fallbackStatus = 500,
): NextResponse<HttpErrorBody> {
  if (error instanceof HttpValidationError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  // Any other failure is unexpected, and its message is not written for a
  // client: filesystem errors carry absolute home paths, database errors carry
  // query fragments. Callers log the real error, so only the caller's own
  // wording crosses the wire.
  return NextResponse.json(
    { error: fallbackMessage, code: null },
    { status: fallbackStatus },
  );
}
