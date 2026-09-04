import { MAX_MEMORY_ENTRY_CHARS } from "@/shared/harness/agentMemory";

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
      issues.push({
        code: "injection",
        message: "Content looks like a prompt injection attempt",
      });
      break;
    }
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(trimmed)) {
      issues.push({
        code: "secret",
        message: "Content may contain secrets or credentials",
      });
      break;
    }
  }
  return issues;
}
