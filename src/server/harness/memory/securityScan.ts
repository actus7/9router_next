import { MAX_MEMORY_ENTRY_CHARS } from "@/shared/harness/agentMemory";
import { scanUntrustedContent } from "@/server/decisions/guardrails";

export interface MemorySecurityIssue {
  code: string;
  message: string;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /system\s+prompt/i,
  /you\s+are\s+now/i,
  /<\/?system>/i,
];

const SECRET_PATTERNS = [
  /\bsk-[a-zA-Z0-9]{20,}\b/,
  /\bghp_[a-zA-Z0-9]{20,}\b/,
  /\bBearer\s+[a-zA-Z0-9._-]{20,}\b/i,
  /\bapi[_-]?key\s*[:=]\s*\S+/i,
];

const INJECTION_MESSAGE = "Content looks like a prompt injection attempt";
const SECRET_MESSAGE = "Content may contain secrets or credentials";

/**
 * Regex scan. Stays exported as the fallback for `scanMemoryContentAsync`
 * (and for accounts without Jev).
 */
export function scanMemoryContent(content: string): MemorySecurityIssue[] {
  const issues: MemorySecurityIssue[] = [];
  const trimmed = content.trim();
  if (!trimmed) {
    issues.push({ code: "empty", message: "Content cannot be empty" });
    return issues;
  }
  if (trimmed.length > MAX_MEMORY_ENTRY_CHARS) {
    issues.push({
      code: "too_long",
      message: `Entry exceeds ${MAX_MEMORY_ENTRY_CHARS} characters`,
    });
  }
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      issues.push({ code: "injection", message: INJECTION_MESSAGE });
      break;
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(trimmed)) {
      issues.push({ code: "secret", message: SECRET_MESSAGE });
      break;
    }
  }
  return issues;
}

/**
 * Jev-first scan: same structural checks, but injection is judged by Jev
 * through `scanUntrustedContent` (secrets there stay regex). Fail-open — if
 * the scan somehow throws, the regex scan above answers instead.
 */
export async function scanMemoryContentAsync(
  content: string,
): Promise<MemorySecurityIssue[]> {
  const trimmed = content.trim();
  if (!trimmed) {
    return [{ code: "empty", message: "Content cannot be empty" }];
  }
  const issues: MemorySecurityIssue[] = [];
  if (trimmed.length > MAX_MEMORY_ENTRY_CHARS) {
    issues.push({
      code: "too_long",
      message: `Entry exceeds ${MAX_MEMORY_ENTRY_CHARS} characters`,
    });
  }
  try {
    const scan = await scanUntrustedContent(content, "memory");
    for (const issue of scan.issues) {
      if (issue.code === "injection") {
        issues.push({ code: "injection", message: INJECTION_MESSAGE });
      } else if (issue.code === "secret") {
        issues.push({ code: "secret", message: SECRET_MESSAGE });
      }
    }
    return issues;
  } catch {
    // `scanUntrustedContent` is fail-open and should never throw. If it does,
    // `scanMemoryContent` reproduces the structural checks and adds the regex
    // verdicts, so the result matches the pre-Jev behaviour exactly.
    return scanMemoryContent(content);
  }
}
