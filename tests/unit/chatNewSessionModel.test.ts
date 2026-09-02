import { describe, expect, it } from "vitest";
import { resolveNewChatModel } from "@/app/(dashboard)/dashboard/basic-chat/hooks/useSessionHandlers";

const models = [
  { id: "oc/big-pickle", requestModel: "oc/big-pickle", name: "Big Pickle", providerId: "opencode", providerName: "OpenCode", source: "catalog" },
  { id: "oc/mimo-v2.5-free", requestModel: "oc/mimo-v2.5-free", name: "MiMo", providerId: "opencode", providerName: "OpenCode", source: "catalog" },
];

describe("resolveNewChatModel", () => {
  it("keeps the last explicitly selected model for a new chat when it remains available", () => {
    expect(resolveNewChatModel("oc/mimo-v2.5-free", new Map(models.map((model) => [model.id, model])), [{ providerId: "opencode", providerName: "OpenCode", providerType: "free", connections: [], models }]))
      .toMatchObject({ id: "oc/mimo-v2.5-free" });
  });

  it("uses the first available model when the remembered choice is unavailable", () => {
    expect(resolveNewChatModel("missing/model", new Map(models.map((model) => [model.id, model])), [{ providerId: "opencode", providerName: "OpenCode", providerType: "free", connections: [], models }]))
      .toMatchObject({ id: "oc/big-pickle" });
  });
});
