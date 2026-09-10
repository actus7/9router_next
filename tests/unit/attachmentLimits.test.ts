import { describe, expect, it } from "vitest";

import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  decideAttachments,
} from "@/app/(dashboard)/dashboard/basic-chat/attachmentLimits";

function file(name: string, type: string, size: number) {
  return { name, type, size };
}

const small = () => file("a.png", "image/png", 1024);

describe("decideAttachments", () => {
  it("accepts images within the limits", () => {
    const decision = decideAttachments([small(), small()], 0);

    expect(decision.accepted).toHaveLength(2);
    expect(decision.notice).toBe("");
  });

  it("rejects anything that is not an image", () => {
    const decision = decideAttachments([file("a.pdf", "application/pdf", 10)], 0);

    expect(decision.accepted).toEqual([]);
    expect(decision.notice).toMatch(/image/i);
  });

  it("rejects an image too large to ride every later request", () => {
    // The data URL lives in the message, so an oversized image is re-sent to
    // the provider on every turn of the conversation, not just this one.
    const decision = decideAttachments([file("big.png", "image/png", MAX_ATTACHMENT_BYTES + 1)], 0);

    expect(decision.accepted).toEqual([]);
    expect(decision.notice).toMatch(/MB/);
  });

  it("caps how many ride one message, counting what is already attached", () => {
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, small);

    const decision = decideAttachments(files, MAX_ATTACHMENTS_PER_MESSAGE - 1);

    expect(decision.accepted).toHaveLength(1);
    expect(decision.notice).toMatch(new RegExp(String(MAX_ATTACHMENTS_PER_MESSAGE)));
  });

  it("takes what it can when only some files are rejected", () => {
    const decision = decideAttachments([small(), file("big.png", "image/png", MAX_ATTACHMENT_BYTES + 1)], 0);

    expect(decision.accepted).toHaveLength(1);
    expect(decision.notice).not.toBe("");
  });
});

describe("estimateContextUsage", () => {
  it("counts what an attachment actually adds to the request", async () => {
    const { estimateContextUsage } = await import(
      "@/app/(dashboard)/dashboard/basic-chat/sections/contextUsageEstimate"
    );
    const dataUrl = `data:image/png;base64,${"A".repeat(40_000)}`;

    const withImage = estimateContextUsage(
      [{ id: "u1", role: "user", content: "hi", attachments: [{ id: "a", name: "a.png", type: "image/png", dataUrl }] }],
      "",
      "",
    );
    const withoutImage = estimateContextUsage([{ id: "u1", role: "user", content: "hi" }], "", "");

    // The meter is the only warning a user gets — there is no history
    // truncation anywhere — and it used to report these two as identical.
    expect(withImage.totalTokens).toBeGreaterThan(withoutImage.totalTokens + 9_000);
  });
});
