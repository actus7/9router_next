import { NextRequest, NextResponse } from "next/server";
import { serializeHttpError } from "@/server/application/http/httpError";
import { parseJsonBody } from "@/server/application/http/requestBody";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { revokeApiKeysForSink, type ApiKeySink } from "@/lib/db/repos/apiKeysRepo";

type JsonBody = Record<string, unknown>;

export interface CliToolRouteHandlers {
  get?: (request: NextRequest) => Promise<unknown>;
  post?: (body: JsonBody, request: NextRequest) => Promise<unknown>;
  patch?: (body: JsonBody, request: NextRequest) => Promise<unknown>;
  delete?: (request: NextRequest) => Promise<unknown>;
}

function toResponse(result: unknown): NextResponse {
  return result instanceof NextResponse ? result : NextResponse.json(result);
}

export function createCliToolHandlers(name: string, handlers: CliToolRouteHandlers) {
  const logLabel = `cli-tools/${name}`;

  return {
    async GET(request: NextRequest) {
      await assertRequestRuntime();
      if (!handlers.get) {
        return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
      }
      try {
        return toResponse(await handlers.get(request));
      } catch (error) {
        console.error(`Error in ${logLabel} GET:`, error);
        return serializeHttpError(error, `Failed to check ${name} settings`);
      }
    },

    async POST(request: NextRequest) {
      await assertRequestRuntime();
      if (!handlers.post) {
        return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
      }
      try {
        const body = await parseJsonBody<JsonBody>(request);
        return toResponse(await handlers.post(body, request));
      } catch (error) {
        console.error(`Error in ${logLabel} POST:`, error);
        return serializeHttpError(error, `Failed to update ${name} settings`);
      }
    },

    async PATCH(request: NextRequest) {
      await assertRequestRuntime();
      if (!handlers.patch) {
        return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
      }
      try {
        const body = await parseJsonBody<JsonBody>(request);
        return toResponse(await handlers.patch(body, request));
      } catch (error) {
        console.error(`Error in ${logLabel} PATCH:`, error);
        return serializeHttpError(error, `Failed to patch ${name} settings`);
      }
    },

    async DELETE(request: NextRequest) {
      await assertRequestRuntime();
      if (!handlers.delete) {
        return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
      }
      try {
        const result = toResponse(await handlers.delete(request));
        // Un-configuring the tool and revoking its key are the same operation
        // from the operator's point of view: the key exists only because this
        // tool's config file needed one. Leaving it live would put a usable
        // credential in the inventory with nothing pointing at it.
        //
        // After the handler, and deliberately not fatal: the config file is
        // already rewritten by then, and failing the reset because the
        // bookkeeping write failed would leave the worse of the two states.
        await revokeApiKeysForSink(`cli:${name}` as ApiKeySink).catch((error: unknown) => {
          console.error(`Error revoking ${logLabel} api key:`, error);
        });
        return result;
      } catch (error) {
        console.error(`Error in ${logLabel} DELETE:`, error);
        return serializeHttpError(error, `Failed to reset ${name} settings`);
      }
    },
  };
}
