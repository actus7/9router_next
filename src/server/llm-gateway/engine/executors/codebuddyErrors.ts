// CodeBuddy answers its frequency limit with `code: 6004` and states when it reopens
// inside the message text, in the gateway's own timezone. Reading it lets the account
// stay out until then instead of taking the generic rate-limit backoff.

const FREQUENCY_LIMIT_WORDING = /超出频率限制|frequency limit|限额/i;
// "2026-10-24 10:00:00", optionally followed by "UTC+8" / "UTC+08:00".
const RESET_TIME = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i;
// The gateway's own zone, which is what an offset-less timestamp means.
const DEFAULT_OFFSET = "+08:00";

function toOffset(raw: string | undefined): string {
  if (!raw) return DEFAULT_OFFSET;
  if (raw.includes(":")) return raw.startsWith("+") ? raw : `+${raw}`;
  return `+${raw.padStart(2, "0")}:00`;
}

export interface CodeBuddyFrequencyLimit {
  status: 429;
  message: string;
  /** When the provider says the limit reopens (ms epoch); null when the message gives no time. */
  resetsAtMs: number | null;
}

/** The 6004 frequency-limit error out of a response body, or null for anything else. */
export function parseCodeBuddyFrequencyLimit(bodyText: string): CodeBuddyFrequencyLimit | null {
  if (!bodyText) return null;
  let data: { code?: unknown; msg?: unknown; message?: unknown; error?: { message?: unknown } };
  try {
    data = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const raw = data?.msg ?? data?.message ?? data?.error?.message ?? "";
  const message = typeof raw === "string" ? raw : "";
  if (data?.code !== 6004 && !FREQUENCY_LIMIT_WORDING.test(message)) return null;

  let resetsAtMs: number | null = null;
  const match = message.match(RESET_TIME);
  if (match) {
    const time = new Date(`${match[1]}T${match[2]}${toOffset(match[3])}`).getTime();
    if (!Number.isNaN(time)) resetsAtMs = time;
  }
  return { status: 429, message: message || "CodeBuddy frequency limit (6004)", resetsAtMs };
}
