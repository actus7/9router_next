import { describe, expect, it } from "vitest";
import { HttpValidationError, parseJsonBody, requireStringField } from "@/server/application/http/requestBody";
import { serializeHttpError } from "@/server/application/http/httpError";

describe("requestBody", () => {
  it("rejects invalid JSON", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    });

    await expect(parseJsonBody(request as never)).rejects.toBeInstanceOf(HttpValidationError);
  });

  it("requires string fields", () => {
    expect(() => requireStringField({ name: "" }, "name")).toThrow(HttpValidationError);
    expect(requireStringField({ name: "  ok  " }, "name")).toBe("ok");
  });
});

describe("httpError", () => {
  it("serializes validation errors", async () => {
    const response = serializeHttpError(new HttpValidationError("bad input", 422, "VALIDATION_ERROR"));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "bad input", code: "VALIDATION_ERROR" });
  });

  it("keeps unexpected error details out of the response body", async () => {
    const enoent = Object.assign(
      new Error("EACCES: permission denied, open 'C:\\Users\\someone\\.claude\\settings.json'"),
      { code: "EACCES" },
    );
    const response = serializeHttpError(enoent, "Failed to check claude settings");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to check claude settings",
      code: null,
    });
  });

  it("falls back for thrown values that are not errors", async () => {
    const response = serializeHttpError("boom", "Failed to update settings", 503);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to update settings",
      code: null,
    });
  });
});
