"use client";

import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale } from "./config";
import type { Locale } from "./config";

// ─── Types ───────────────────────────────────────────────────────────────────

type TranslationMap = Record<string, string>;
type ReloadCallback = () => void;

interface TranslatedText extends Text {
  _originalText?: string;
  _translatedText?: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

// Check for server-injected translations (set via <script> tag before React hydrates)
const g =
  typeof globalThis !== "undefined"
    ? (globalThis as Record<string, unknown>)
    : {};
const serverLocale = g.__I18N_LOCALE__ as Locale | undefined;
const serverTranslations = g.__I18N_TRANSLATIONS__ as
  TranslationMap | undefined;

let translationMap: TranslationMap = serverTranslations || {};
let currentLocale: Locale = serverLocale || DEFAULT_LOCALE;
let reloadCallbacks: ReloadCallback[] = [];

// Read locale from cookie
function getLocaleFromCookie(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const cookie: string | undefined = document.cookie
    .split(";")
    .find((c: string) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value: string = cookie
    ? decodeURIComponent(cookie.split("=")[1])
    : DEFAULT_LOCALE;
  return normalizeLocale(value);
}

// Load translation map
async function loadTranslations(locale: Locale): Promise<void> {
  if (locale === "en") {
    translationMap = {};
    return;
  }

  try {
    const response: Response = await fetch(`/i18n/literals/${locale}.json`);
    translationMap = await response.json();
  } catch (err: unknown) {
    console.error("Failed to load translations:", err);
    translationMap = {};
  }
}

// Translate text - exported for use in components
export function translate(
  text: string | null | undefined,
): string | null | undefined {
  if (!text || typeof text !== "string") return text;
  const trimmed: string = text.trim();
  if (!trimmed) return text;
  if (currentLocale === "en") return text;
  return translationMap[trimmed] || text;
}

// Get current locale - exported for use in components
export function getCurrentLocale(): Locale {
  return currentLocale;
}

// Register callback for locale changes
export function onLocaleChange(callback: ReloadCallback): () => void {
  reloadCallbacks.push(callback);
  return () => {
    reloadCallbacks = reloadCallbacks.filter(
      (cb: ReloadCallback) => cb !== callback,
    );
  };
}

// Process text node
function processTextNode(node: Text): void {
  if (!node.nodeValue || !node.nodeValue.trim()) return;

  // Skip if parent is script, style, code, or structural elements
  const parent: HTMLElement | null = node.parentElement;
  if (!parent) return;

  // Skip if parent or any ancestor has data-i18n-skip attribute
  let element: HTMLElement | null = parent;
  while (element) {
    if (element.hasAttribute && element.hasAttribute("data-i18n-skip")) {
      return;
    }
    element = element.parentElement;
  }

  const tagName: string | undefined = parent.tagName?.toLowerCase();

  // Skip elements that don't allow text nodes
  const skipTags: string[] = [
    "script",
    "style",
    "code",
    "pre",
    "colgroup",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "select",
    "datalist",
    "optgroup",
  ];

  if (skipTags.includes(tagName!)) return;

  // React may reuse a Text node while replacing its content during client-side
  // navigation. If that happens, discard the prior source text: otherwise a
  // page title such as "Providers" can be rewritten with the previous route's
  // translated title (for example, "Chat").
  const translatedNode = node as TranslatedText;
  if (
    !translatedNode._originalText ||
    (translatedNode._translatedText !== undefined &&
      node.nodeValue !== translatedNode._translatedText)
  ) {
    translatedNode._originalText = node.nodeValue;
  }

  // Use original text for translation
  const original: string = translatedNode._originalText!;
  const translated: string | null | undefined = translate(original);

  // Only update if different to avoid unnecessary DOM mutations
  if (translated != null && translated !== node.nodeValue) {
    node.nodeValue = translated;
  }
  translatedNode._translatedText = translated ?? original;
}

// ─── Hydration-safe scheduling ───────────────────────────────────────────────

// React attaches `__reactFiber$…` to a DOM node only once it owns it: after
// hydrating the server's HTML for it, or after creating it itself. Rewriting the
// text of a node it has not claimed yet is exactly what it reports as a
// hydration mismatch, and waiting N frames does not fix it — a streamed Suspense
// boundary is hydrated whenever its client chunk finishes loading, which in dev
// is however long Turbopack takes. So the gate is the fiber, not a timer.
//
// A node React never claims is not React's to begin with (markup injected
// through `dangerouslySetInnerHTML`, a browser extension), so it is dropped
// rather than translated once the wait runs out.
const HYDRATION_WAIT_MS = 10_000;

interface PendingNode {
  node: Text;
  since: number;
}

let fiberKey: string | null = null;
let pending: PendingNode[] = [];
let flushHandle: number | undefined;

function isClaimedByReact(element: Element): boolean {
  if (fiberKey && Object.prototype.hasOwnProperty.call(element, fiberKey)) {
    return true;
  }
  const key: string | undefined = Object.keys(element).find((k: string) =>
    k.startsWith("__reactFiber$"),
  );
  if (!key) return false;
  fiberKey = key;
  return true;
}

function collectTextNodes(root: Node): Text[] {
  if (root.nodeType === Node.TEXT_NODE) {
    return root.nodeValue?.trim() ? [root as Text] : [];
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
    return [];
  }

  const walker: TreeWalker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    null,
  );

  // Collect all nodes first to avoid live collection issues
  const nodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.nodeValue?.trim()) nodes.push(node);
  }
  return nodes;
}

function flushPending(): void {
  flushHandle = undefined;
  const queue: PendingNode[] = pending;
  pending = [];
  const now: number = Date.now();

  queue.forEach((entry: PendingNode) => {
    const parent: HTMLElement | null = entry.node.parentElement;
    if (!entry.node.isConnected || !parent) return;
    if (isClaimedByReact(parent)) {
      processTextNode(entry.node);
      return;
    }
    if (now - entry.since > HYDRATION_WAIT_MS) return;
    pending.push(entry);
  });

  if (pending.length > 0) scheduleFlush();
}

function scheduleFlush(): void {
  if (flushHandle !== undefined) return;
  flushHandle = requestAnimationFrame(flushPending);
}

// Queue every text node under `root` for translation once React has claimed it.
function scheduleNode(root: Node): void {
  const since: number = Date.now();
  collectTextNodes(root).forEach((node: Text) => pending.push({ node, since }));
  if (pending.length > 0) scheduleFlush();
}

// Apply server-provided translations synchronously (before render).
// This sets the module-level variables so translate() returns correct text
// during the initial client render, preventing hydration mismatches.
export function seedRuntimeI18n(
  locale: Locale,
  translations: TranslationMap = {},
): void {
  currentLocale = locale;
  translationMap = translations;
  if (typeof globalThis !== "undefined") {
    (globalThis as Record<string, unknown>).__I18N_LOCALE__ = locale;
    (globalThis as Record<string, unknown>).__I18N_TRANSLATIONS__ = translations;
  }
}

// Initialize runtime i18n (fallback when server props not available)
export async function initRuntimeI18n(): Promise<void> {
  if (typeof window === "undefined") return;

  const cookieLocale = getLocaleFromCookie();
  const hasSeededTranslations =
    cookieLocale === currentLocale &&
    (currentLocale === "en" || Object.keys(translationMap).length > 0);

  if (!hasSeededTranslations) {
    currentLocale = cookieLocale;
    await loadTranslations(currentLocale);
  }

  // Process existing DOM
  scheduleNode(document.body);

  // Watch for new nodes
  const observer: MutationObserver = new MutationObserver(
    (mutations: MutationRecord[]) => {
      mutations.forEach((mutation: MutationRecord) => {
        mutation.addedNodes.forEach((node: Node) => {
          if (
            node.nodeType === Node.ELEMENT_NODE ||
            node.nodeType === Node.TEXT_NODE
          ) {
            scheduleNode(node);
          }
        });
      });
    },
  );

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Reload translations when locale changes
export async function reloadTranslations(): Promise<void> {
  currentLocale = getLocaleFromCookie();
  await loadTranslations(currentLocale);

  // Notify all registered callbacks
  reloadCallbacks.forEach((callback: ReloadCallback) => callback());

  // Re-process entire DOM (will use stored original text)
  scheduleNode(document.body);
}
