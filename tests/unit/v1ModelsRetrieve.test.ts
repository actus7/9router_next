import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildModelsList } = vi.hoisted(() => ({ buildModelsList: vi.fn() }));
vi.mock("@/server/application/http/gatewayRoute", () => ({ gatewayRoute: (h: unknown) => h }));
vi.mock("@/server/application/use-cases/http/v1/models/route", () => ({ buildModelsList }));

import { GET } from "@/app/api/v1/models/[...id]/route";
import { buildProviderModelEntries } from "@/server/application/use-cases/http/v1/models/modelsListProviderEntries";
import { buildComboEntries } from "@/server/application/use-cases/http/v1/models/modelsListBuilders";

const call = (id: string[]) =>
  (GET as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request(`http://x/v1/models/${id.join("/")}`),
    { params: Promise.resolve({ id }) },
  );

describe("GET /v1/models/{model}", () => {
  beforeEach(() => {
    buildModelsList.mockReset();
    buildModelsList.mockResolvedValue([{ id: "openai/gpt-4o", object: "model", created: 1, owned_by: "openai", context_length: 9 }]);
  });

  it("retrieves a model whose id contains a slash", async () => {
    const res = await call(["openai", "gpt-4o"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "openai/gpt-4o", object: "model", created: 1, owned_by: "openai" });
  });

  it("answers an unknown model with model_not_found", async () => {
    const res = await call(["nope"]);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatchObject({ type: "invalid_request_error", code: "model_not_found" });
  });

  it("still lists by kind", async () => {
    const res = await call(["embedding"]);
    expect(buildModelsList).toHaveBeenCalledWith(["embedding"]);
    expect((await res.json()).object).toBe("list");
  });
});

describe("/v1/models entries carry created", () => {
  it("on provider and combo entries", () => {
    const ctx = {
      providerId: "openai", outputAlias: "openai", staticAlias: "openai", rawModelIds: [],
      staticModelKindById: new Map(), liveModelKindById: new Map(), liveCapabilitiesById: new Map(),
    };
    const [model] = buildProviderModelEntries(ctx, ["gpt-4o"], new Map(), ["llm"], () => false);
    expect(Number.isInteger(model.created)).toBe(true);
    expect(Number.isInteger(buildComboEntries([{ name: "c" }], ["llm"])[0].created)).toBe(true);
  });
});
