import fs from "fs";
import path from "path";
import { DATA_DIR } from "@/lib/dataDir";

export const TUNNEL_DIR: string = path.join(DATA_DIR, "tunnel");
const STATE_FILE: string = path.join(TUNNEL_DIR, "state.json");

const SHORT_ID_LENGTH: number = 6;
const SHORT_ID_CHARS: string = "abcdefghijklmnpqrstuvwxyz23456789";

interface TunnelState {
  shortId: string;
  tunnelUrl: string | null;
  [key: string]: unknown;
}

export function ensureTunnelDir(): void {
  if (!fs.existsSync(TUNNEL_DIR)) fs.mkdirSync(TUNNEL_DIR, { recursive: true });
}

export function loadState(): TunnelState | null {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch { /* ignore corrupt state */ }
  return null;
}

export function saveState(state: TunnelState): void {
  ensureTunnelDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}


export function generateShortId(): string {
  let result: string = "";
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    result += SHORT_ID_CHARS.charAt(Math.floor(Math.random() * SHORT_ID_CHARS.length));
  }
  return result;
}
