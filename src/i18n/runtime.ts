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

interface TranslatedElement extends HTMLElement {
  _originalAttrs?: Record<string, string>;
  _translatedAttrs?: Record<string, string>;
}

// Attributes that reach the user as prose. A text node is not the only place a
// sentence shows up: a tooltip, a field hint and a screen reader label are all
// English until these are rewritten too, and wrapping every one of them in
// `translate()` by hand is the same job done several hundred times.
const TRANSLATABLE_ATTRS: readonly string[] = [
  "title",
  "placeholder",
  "aria-label",
  "alt",
];

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

// Skip if the element or any ancestor carries data-i18n-skip
function isSkipped(from: HTMLElement | null): boolean {
  let element: HTMLElement | null = from;
  while (element) {
    if (element.hasAttribute && element.hasAttribute("data-i18n-skip")) {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

// Process the translatable attributes of an element
function processElementAttrs(element: HTMLElement): void {
  const translated = element as TranslatedElement;
  const originals: Record<string, string> = translated._originalAttrs ?? {};
  const previous: Record<string, string> = translated._translatedAttrs ?? {};
  let skipped: boolean | undefined;

  TRANSLATABLE_ATTRS.forEach((attr: string) => {
    const current: string | null = element.getAttribute(attr);
    if (current === null || !current.trim()) return;

    // React reuses DOM nodes across renders, so a value that no longer matches
    // what we wrote is a new source string, not ours to keep translating.
    if (originals[attr] === undefined || (previous[attr] !== undefined && current !== previous[attr])) {
      originals[attr] = current;
    }

    // Only pay for the ancestor walk once an element actually has something to
    // translate — most elements carry none of these attributes.
    if (skipped === undefined) skipped = isSkipped(element);
    if (skipped) return;

    const next: string = translate(originals[attr]) ?? originals[attr];
    if (next !== current) element.setAttribute(attr, next);
    previous[attr] = next;
  });

  if (Object.keys(originals).length > 0) {
    translated._originalAttrs = originals;
    translated._translatedAttrs = previous;
  }
}

// Process text node
function processTextNode(node: Text): void {
  if (!node.nodeValue || !node.nodeValue.trim()) return;

  // Skip if parent is script, style, code, or structural elements
  const parent: HTMLElement | null = node.parentElement;
  if (!parent) return;

  if (isSkipped(parent)) return;

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
  node: Text | HTMLElement;
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

function hasTranslatableAttr(element: Element): boolean {
  return TRANSLATABLE_ATTRS.some((attr: string) => element.hasAttribute(attr));
}

// Every text node plus every element carrying a translatable attribute.
function collectTranslatable(root: Node): (Text | HTMLElement)[] {
  if (root.nodeType === Node.TEXT_NODE) {
    return root.nodeValue?.trim() ? [root as Text] : [];
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
    return [];
  }

  const nodes: (Text | HTMLElement)[] = [];
  if (root.nodeType === Node.ELEMENT_NODE && hasTranslatableAttr(root as Element)) {
    nodes.push(root as HTMLElement);
  }

  const walker: TreeWalker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    null,
  );

  // Collect all nodes first to avoid live collection issues
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.nodeValue?.trim()) nodes.push(node as Text);
    } else if (hasTranslatableAttr(node as Element)) {
      nodes.push(node as HTMLElement);
    }
  }
  return nodes;
}

function flushPending(): void {
  flushHandle = undefined;
  const queue: PendingNode[] = pending;
  pending = [];
  const now: number = Date.now();

  queue.forEach((entry: PendingNode) => {
    const isText: boolean = entry.node.nodeType === Node.TEXT_NODE;
    // An element owns its own attributes, so it is the element React must have
    // claimed; for a text node that gate belongs to its parent.
    const owner: HTMLElement | null = isText
      ? entry.node.parentElement
      : (entry.node as HTMLElement);
    if (!entry.node.isConnected || !owner) return;
    if (isClaimedByReact(owner)) {
      if (isText) processTextNode(entry.node as Text);
      else processElementAttrs(entry.node as HTMLElement);
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

// Queue everything translatable under `root` once React has claimed it.
function scheduleNode(root: Node): void {
  const since: number = Date.now();
  collectTranslatable(root).forEach((node: Text | HTMLElement) =>
    pending.push({ node, since }),
  );
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
