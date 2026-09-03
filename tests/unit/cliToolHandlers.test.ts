import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { HttpValidationError } from "@/server/application/http/requestBody";
import { createCliToolHandlers } from "@/server/application/use-cases/http/cli-tools/createCliToolHandlers";

describe("createCliToolHandlers", () => {
  it("serializes validation errors from POST handlers", async () => {
    const { POST } = createCliToolHandlers("test-tool", {
      post: async () => {
        throw new HttpValidationError("baseUrl is required", 400, "VALIDATION_ERROR");
      },
    });

    const request = new NextRequest("http://localhost/api/cli-tools/test-tool", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "baseUrl is required",
      code: "VALIDATION_ERROR",
    });
  });

  it("returns handler data as JSON for GET", async () => {
    const { GET } = createCliToolHandlers("test-tool", {
      get: async () => ({ installed: true }),
    });

    const response = await GET(new NextRequest("http://localhost"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ installed: true });
  });
});
