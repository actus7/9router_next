"use client";

import { textValue } from "./chatFormatUtils";
import type { ChatMessage, NormalizedModel } from "./types";

export const PUTER_PROVIDER_ID = "puter";
export const PUTER_MODEL_ID = "xiaomi/mimo-v2.5";
const PUTER_SCRIPT_URL = "https://js.puter.com/v2/";

type PuterChatMessage = {
  content: string;
  role: "assistant" | "system" | "user";
};

type PuterChatChunk = { text?: string };
type PuterChatResponse = { message?: { content?: string }; text?: string };

type PuterGlobal = {
  ai: {
    chat: (
      messages: PuterChatMessage[],
      options: { model: string; stream: true },
    ) => Promise<AsyncIterable<PuterChatChunk> | PuterChatResponse | string>;
  };
  auth: {
    isSignedIn: () => boolean | Promise<boolean>;
    signIn: (options?: { attempt_temp_user_creation?: boolean }) => Promise<unknown>;
    signOut: () => Promise<unknown>;
    getUser: () => Promise<{ username?: string }>;
  };
};

declare global {
  interface Window {
    puter?: PuterGlobal;
  }
}

let puterLoadPromise: Promise<PuterGlobal> | null = null;

function abortError(): DOMException {
  return new DOMException("Puter request was cancelled.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function getPuter(): PuterGlobal {
  if (typeof window === "undefined") {
    throw new Error("Puter is only available in the browser.");
  }
  const puter = window.puter;
  if (!puter?.ai?.chat || !puter.auth?.isSignedIn || !puter.auth?.signIn) {
    throw new Error("Puter SDK loaded without the required AI and authentication APIs.");
  }
  return puter;
}

function loadPuter(): Promise<PuterGlobal> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Puter is only available in the browser."));
  }
  if (window.puter?.ai?.chat) return Promise.resolve(getPuter());
  if (puterLoadPromise) return puterLoadPromise;

  puterLoadPromise = new Promise<PuterGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-routerx-puter="true"]');
    const resolveSdk = () => {
      try {
        resolve(getPuter());
      } catch (error) {
        reject(error);
      }
    };

    if (existing) {
      existing.addEventListener("load", resolveSdk, { once: true });
      existing.addEventListener("error", () => reject(new Error("Unable to load Puter SDK.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.dataset.routerxPuter = "true";
    script.src = PUTER_SCRIPT_URL;
    script.addEventListener("load", resolveSdk, { once: true });
    script.addEventListener("error", () => reject(new Error("Unable to load Puter SDK.")), { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    puterLoadPromise = null;
    throw error;
  });

  return puterLoadPromise;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<PuterChatChunk> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function responseText(response: PuterChatResponse | string): string {
  if (typeof response === "string") return response;
  return response.message?.content ?? response.text ?? "";
}

export function isPuterBrowserModel(model: NormalizedModel): boolean {
  return model.providerId === PUTER_PROVIDER_ID;
}

export type PuterAuthStatus = { isSignedIn: boolean; username?: string };

export async function getPuterAuthStatus(): Promise<PuterAuthStatus> {
  const puter = await loadPuter();
  if (!(await puter.auth.isSignedIn())) return { isSignedIn: false };
  const user = await puter.auth.getUser().catch(() => ({}) as { username?: string });
  return { isSignedIn: true, username: user.username };
}

// Opens Puter's real sign-in dialog (no attempt_temp_user_creation) so the
// user can log into an account that actually has credit, instead of the
// zero-setup throwaway session streamPuterChat falls back to.
export async function signInToPuter(): Promise<void> {
  const puter = await loadPuter();
  await puter.auth.signIn();
}

export async function signOutOfPuter(): Promise<void> {
  const puter = await loadPuter();
  await puter.auth.signOut();
}

export function toPuterMessages(messages: readonly ChatMessage[], assistantMessageId: string, systemPrompt: string): PuterChatMessage[] {
  const result: PuterChatMessage[] = systemPrompt.trim() ? [{ role: "system", content: systemPrompt.trim() }] : [];
  for (const message of messages) {
    if (message.id === assistantMessageId || (message.role !== "assistant" && message.role !== "user")) continue;
    const content = textValue(message.content).trim();
    if (content) result.push({ role: message.role, content });
  }
  return result;
}

export async function streamPuterChat(input: {
  messages: PuterChatMessage[];
  onTextDelta: (delta: string) => void;
  signal: AbortSignal;
}): Promise<string> {
  throwIfAborted(input.signal);
  const puter = await loadPuter();
  if (!(await puter.auth.isSignedIn())) {
    // attempt_temp_user_creation lets Puter create a throwaway session
    // automatically instead of requiring a real account signup — this is
    // what makes the provider genuinely zero-setup ("free", not "free after
    // you make an account somewhere else").
    await puter.auth.signIn({ attempt_temp_user_creation: true });
  }
  throwIfAborted(input.signal);

  const response = await puter.ai.chat(input.messages, { model: PUTER_MODEL_ID, stream: true });
  if (!isAsyncIterable(response)) {
    const text = responseText(response);
    if (text) input.onTextDelta(text);
    return text;
  }

  let fullText = "";
  for await (const chunk of response) {
    throwIfAborted(input.signal);
    if (!chunk.text) continue;
    fullText += chunk.text;
    input.onTextDelta(chunk.text);
  }
  return fullText;
}
