import { NextRequest, NextResponse } from "next/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { safePublicFetch } from "@/server/security/safeFetch";
import {
  parseSkillMarkdown,
  validateSkillFields,
} from "@/server/harness/skills/parseSkillMarkdown";

const MAX_IMPORT_BYTES = 128 * 1024;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  await assertRequestRuntime();
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return badRequest("url is required");

  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:") {
    return badRequest("import URL must use HTTPS");
  }

  let response: Response;
  try {
    response = await safePublicFetch(url, {
      destinationPolicy: "public-only",
      timeoutMs: 15_000,
    });
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "Failed to fetch URL",
    );
  }

  if (!response.ok) {
    return badRequest(`Remote URL responded with status ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_IMPORT_BYTES) {
    return badRequest(`Remote content exceeds ${MAX_IMPORT_BYTES} bytes`);
  }

  const raw = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  let parsed;
  try {
    parsed = parseSkillMarkdown(raw);
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "Invalid SKILL.md",
    );
  }

  const errors = validateSkillFields({
    id: parsed.name,
    description: parsed.description,
    body: parsed.body,
  });
  if (errors.length) {
    return badRequest(errors.map((e) => e.message).join("; "));
  }

  return NextResponse.json({
    ok: true,
    draft: {
      id: parsed.name,
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      enabled: false,
      source: "imported" as const,
      origin: url,
    },
    raw,
  });
}
