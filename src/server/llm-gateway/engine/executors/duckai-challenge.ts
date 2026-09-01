/**
 * Duck.ai VQD Challenge Solver — 3-layer strategy:
 *
 * 1. **jsdom** with dynamic deobfuscation patches (fast, lightweight)
 * 2. **jsdom retry** up to 4 attempts (DuckDuckGo rotates challenge scripts)
 * 3. **Puppeteer** headless browser fallback (warm singleton when available)
 *
 * Layer 3 keeps a browser instance "warm" so subsequent fallbacks are fast.
 *
 * Heavy deps (jsdom, puppeteer) are loaded via dynamic import — only when the
 * configured runtime actually needs them.
 */

import { solveVqdChallengeWithBrowser } from "./duckaiChallengeBrowser";
import { dynamicImport } from "./duckaiOptionalDependency";
import { DUCKAI_USER_AGENT, type DuckAiChallengeRuntime, type VqdChallengeResult } from "./duckaiChallengeTypes";

export type { DuckAiChallengeRuntime, VqdChallengeResult } from "./duckaiChallengeTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readNumberEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getDuckAiChallengeRuntime(): DuckAiChallengeRuntime {
  const rawRuntime = process.env.DUCKAI_CHALLENGE_RUNTIME?.trim().toLowerCase();
  if (rawRuntime === "browser" || rawRuntime === "puppeteer") return "browser";
  if (rawRuntime === "off" || rawRuntime === "disabled") return "off";
  if (
    rawRuntime === "jsdom-dangerous" &&
    process.env.DUCKAI_ALLOW_UNTRUSTED_CHALLENGE_CODE === "true"
  ) {
    return "jsdom-dangerous";
  }

  const legacyBrowserFallback = process.env.DUCKAI_BROWSER_FALLBACK?.trim().toLowerCase();
  if (legacyBrowserFallback === "0" || legacyBrowserFallback === "false") return "off";
  if (legacyBrowserFallback === "1" || legacyBrowserFallback === "true") return "browser";

  if (process.env.DUCKAI_BROWSER_WS_ENDPOINT?.trim()) {
    return "browser";
  }

  // Local/dev can use the bundled Puppeteer browser. Production should use
  // DUCKAI_BROWSER_WS_ENDPOINT or an explicit runtime setting.
  return process.env.VERCEL ? "off" : "browser";
}

// ---------------------------------------------------------------------------
// Layer 3 — Puppeteer warm browser singleton
// ---------------------------------------------------------------------------

// Layer 1 — Dynamic deobfuscation (pre-process challenge source)
// ---------------------------------------------------------------------------

/**
 * Inject safety wrappers around known problematic patterns in the challenge
 * script before executing in jsdom.  This is a best-effort heuristic that
 * catches null-access patterns the obfuscated code uses.
 */
const DEOBFUSCATION_HELPERS = `
  ;(function(){
    var createSafeDocument = function() {
      return document.implementation.createHTMLDocument('');
    };

    if(!window.__safeCD){
      window.__safeCD=function(target){
        try {
          if(target && target.contentDocument) return target.contentDocument;
        } catch(e) {}
        return createSafeDocument();
      };
    }

    if(!window.__safeCW){
      window.__safeCW=function(target){
        try {
          if(target && target.contentWindow) return target.contentWindow;
        } catch(e) {}
        return window;
      };
    }

    var defineAliasGetter = function(name, resolver) {
      var descriptor = Object.getOwnPropertyDescriptor(Object.prototype, name);
      if (descriptor && typeof descriptor.get === 'function') return;

      Object.defineProperty(Object.prototype, name, {
        configurable: true,
        enumerable: false,
        get: function() {
          return resolver(this);
        }
      });
    };

    defineAliasGetter('__duckContentDocument', function(target) {
      return window.__safeCD(target);
    });

    defineAliasGetter('__duckContentWindow', function(target) {
      return window.__safeCW(target);
    });
  })();
`;

function rewriteNullableAccess(
  source: string,
  property: "contentDocument" | "contentWindow",
  helperName: "__safeCD" | "__safeCW"
) {
  const dotPattern = new RegExp(
    `([_$a-zA-Z0-9\\]\\)\\.\\\"\\']+)\\.${property}\\b`, "g"
  );
  const bracketPattern = new RegExp(
    `([_$a-zA-Z0-9\\]\\)\\.\\\"\\']+)\\[(?:'|\")${property}(?:'|\")\\]`, "g"
  );
  return source
    .replace(dotPattern, `window.${helperName}($1)`)
    .replace(bracketPattern, `window.${helperName}($1)`);
}

function deobfuscateChallenge(script: string): string {
  if (!script.trim()) {
    return `(async function(){${DEOBFUSCATION_HELPERS}})()`;
  }

  const patched = rewriteNullableAccess(
    rewriteNullableAccess(script, "contentDocument", "__safeCD"),
    "contentWindow",
    "__safeCW"
  )
    .replace(/(['"])contentDocument\1/g, "$1__duckContentDocument$1")
    .replace(/(['"])contentWindow\1/g, "$1__duckContentWindow$1");

  return `(async function(){${DEOBFUSCATION_HELPERS}\nreturn await (${patched});})()`;
}

// ---------------------------------------------------------------------------
// jsdom iframe patching
// ---------------------------------------------------------------------------

type JsdomWindowLike = typeof globalThis & {
  HTMLFrameElement?: { prototype: unknown };
  HTMLIFrameElement?: { prototype: unknown };
  MutationObserver?: typeof MutationObserver;
  __challengeResult?: Promise<unknown>;
  document: Document;
  close: () => void;
};

type JsdomLike = { window: JsdomWindowLike };

/**
 * Patch the jsdom environment so the Duck.ai challenge script can use iframes.
 *
 * The challenge script accesses iframe content in multiple ways depending on
 * the version DuckDuckGo serves:
 *   1. `iframe.contentDocument` / `iframe.contentWindow`
 *   2. `window.frames[0]` or `window[0]` (the frames collection)
 *
 * jsdom doesn't populate `window.frames` / numeric window indices and returns
 * null for `contentDocument` on un-navigated iframes.  We patch both paths so
 * the challenge always gets usable stub objects instead of crashing.
 */
function createFrameWindow(win: JsdomWindowLike, frameElement: unknown) {
  const doc = win.document.implementation.createHTMLDocument("");
  const frameWin = Object.create(win) as Window & typeof globalThis;
  Object.defineProperties(frameWin, {
    contentDocument: { configurable: true, enumerable: true, get: () => doc },
    document: { configurable: true, enumerable: true, get: () => doc },
    frameElement: { configurable: true, enumerable: true, get: () => frameElement ?? null },
    parent: { configurable: true, enumerable: true, get: () => win },
    self: { configurable: true, enumerable: true, get: () => frameWin },
    top: { configurable: true, enumerable: true, get: () => win },
    window: { configurable: true, enumerable: true, get: () => frameWin },
  });
  return { doc, win: frameWin };
}

function installFrameAccessors(
  target: Record<string, unknown>,
  getFrameState: (el: unknown) => { doc: Document; win: Window & typeof globalThis }
) {
  Object.defineProperty(target, "contentDocument", {
    configurable: true, enumerable: true,
    get() { return getFrameState(this).doc; },
  });
  Object.defineProperty(target, "contentWindow", {
    configurable: true, enumerable: true,
    get() { return getFrameState(this).win; },
  });
}

function patchWindowFrames(win: JsdomWindowLike, defaultWin: Window & typeof globalThis) {
  const framesProxy = new Proxy([] as unknown[], {
    get(_target, prop) {
      if (prop === "length") return 1;
      if (typeof prop === "string" && /^\d+$/.test(prop)) return defaultWin;
      return undefined;
    },
  });
  try {
    Object.defineProperty(win, "frames", { configurable: true, enumerable: true, get: () => framesProxy });
  } catch { /* Some jsdom versions freeze window.frames */ }
  try {
    Object.defineProperty(win, "0", { configurable: true, enumerable: false, get: () => defaultWin });
  } catch { /* ignore */ }
}

function patchCreateElement(
  win: JsdomWindowLike,
  patchIframe: (el: unknown) => void
) {
  const orig = win.document.createElement.bind(win.document);
  (win.document as unknown as Record<string, unknown>).createElement = function (
    tagName: string, options?: ElementCreationOptions
  ) {
    const el = orig(tagName, options);
    if (tagName.toLowerCase() === "iframe" || tagName.toLowerCase() === "frame") patchIframe(el);
    return el;
  } as typeof win.document.createElement;
}

function observeIframeInsertions(win: JsdomWindowLike, patchIframe: (el: unknown) => void) {
  const MO = win.MutationObserver;
  if (!MO) return;
  const observer = new MO((mutations: MutationRecord[]) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        const tag = (node as Element).tagName;
        if (tag === "IFRAME" || tag === "FRAME") patchIframe(node);
        if (typeof (node as Element).querySelectorAll === "function") {
          for (const iframe of Array.from((node as Element).querySelectorAll("iframe,frame"))) {
            patchIframe(iframe);
          }
        }
      }
    }
  });
  observer.observe(win.document, { childList: true, subtree: true });
}

function patchJsdomForIframes(dom: JsdomLike): void {
  const win = dom.window;
  const frameConstructors = [win.HTMLIFrameElement, win.HTMLFrameElement].filter(Boolean) as Array<{
    prototype: unknown;
  }>;
  if (frameConstructors.length === 0) return;

  const frameStates = new WeakMap<object, { doc: Document; win: Window & typeof globalThis }>();
  const defaultFrameState = createFrameWindow(win, null);

  const getFrameState = (frameElement: unknown) => {
    if (!frameElement || typeof frameElement !== "object") return defaultFrameState;
    let state = frameStates.get(frameElement as object);
    if (!state) {
      state = createFrameWindow(win, frameElement);
      frameStates.set(frameElement as object, state);
    }
    return state;
  };

  for (const FrameClass of frameConstructors) {
    installFrameAccessors(FrameClass.prototype as Record<string, unknown>, getFrameState);
  }

  patchWindowFrames(win, defaultFrameState.win);

  const patchIframe = (el: unknown) => {
    getFrameState(el);
    installFrameAccessors(el as Record<string, unknown>, getFrameState);
  };

  patchCreateElement(win, patchIframe);
  observeIframeInsertions(win, patchIframe);
}

// ---------------------------------------------------------------------------
// jsdom challenge execution
// ---------------------------------------------------------------------------

type JsdomCtor = new (html: string, options?: Record<string, unknown>) => JsdomLike;

let jsdomCtorPromise: Promise<JsdomCtor> | null = null;

async function getJsdomCtor(): Promise<JsdomCtor> {
  if (!jsdomCtorPromise) {
    jsdomCtorPromise = (async () => {
      try {
        const mod = (await dynamicImport("jsdom")) as { JSDOM: JsdomCtor };
        return mod.JSDOM;
      } catch {
        throw new Error(
          "jsdom is not installed. Run: npm install jsdom  (required for DUCKAI_CHALLENGE_RUNTIME=jsdom-dangerous)"
        );
      }
    })();
    // Don't cache a rejected promise — allow a later call to retry the load
    jsdomCtorPromise.catch(() => { jsdomCtorPromise = null; });
  }
  return jsdomCtorPromise;
}

function isJsdomUnavailableError(error: Error): boolean {
  return (
    error.message.includes("Failed to load external module jsdom") ||
    error.message.includes("ERR_REQUIRE_ESM") ||
    (error as NodeJS.ErrnoException).code === "ENOENT" ||
    error.message.includes("default-stylesheet.css") ||
    (error.message.includes("ENOENT") && error.message.includes("jsdom"))
  );
}

/**
 * Execute the Duck.ai VQD v4 challenge JS using jsdom.
 * @param useDeobfuscation - when true, injects safety wrappers (as a separate
 *   script) into the DOM before executing the challenge.
 */
async function solveVqdChallenge(
  challengeB64: string,
  useDeobfuscation = false
): Promise<VqdChallengeResult> {
  const decoded = Buffer.from(challengeB64, "base64").toString("utf-8");
  const preparedChallenge = useDeobfuscation ? deobfuscateChallenge(decoded) : decoded;
  const JSDOM = await getJsdomCtor();

  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", {
    url: "https://duck.ai/",
    pretendToBeVisual: true,
    runScripts: "dangerously",
  }) as unknown as JsdomLike;

  // Override navigator properties to match our DUCKAI_USER_AGENT
  Object.defineProperty(dom.window.navigator, "webdriver", {
    get: () => false,
    configurable: true,
  });
  Object.defineProperty(dom.window.navigator, "userAgent", {
    get: () => DUCKAI_USER_AGENT,
    configurable: true,
  });

  // Patch jsdom so the challenge script can use iframes
  patchJsdomForIframes(dom);

  // Execute the challenge script inside jsdom
  const scriptEl = dom.window.document.createElement("script");
  scriptEl.textContent = `
    window.__challengeResult = (async function() {
      try {
        return await (${preparedChallenge});
      } catch(e) {
        return { __error: e.message, __stack: e.stack };
      }
    })();
  `;
  dom.window.document.head.appendChild(scriptEl);

  const result = (await dom.window.__challengeResult) as VqdChallengeResult & {
    __error?: string;
    __stack?: string;
  };
  dom.window.close();

  if (result?.__error) {
    console.error("[Duck.ai] challenge script stack:", result.__stack);
    console.error("[Duck.ai] challenge preview:", preparedChallenge.slice(0, 500));
    throw new Error(`Challenge execution failed: ${result.__error}`);
  }
  if (!result?.server_hashes) {
    throw new Error("Challenge returned invalid data");
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API: solveVqdChallengeMultiLayer
// ---------------------------------------------------------------------------

const JSDOM_MAX_RETRIES = readNumberEnv("DUCKAI_JSDOM_MAX_RETRIES", 4);

export type VqdSolveOutcome = {
  result: VqdChallengeResult;
  browserFallbackUsed: boolean;
  jsdomAttempts: number;
};

/**
 * Solve the VQD challenge using the configured runtime strategy.
 *
 * - `browser`: Puppeteer only (fast warm singleton)
 * - `jsdom-dangerous`: jsdom with deobfuscation, up to JSDOM_MAX_RETRIES attempts
 * - `off`: throws immediately
 */
async function solveVqdWithBrowser(challengeB64: string, cookies?: string): Promise<VqdSolveOutcome> {
  try {
    const result = await solveVqdChallengeWithBrowser(challengeB64, cookies);
    console.log(
      `[Duck.ai][challenge] ${JSON.stringify({
        browserFallbackUsed: true, finalOutcome: "success", jsdomAttempts: 0, phase: "vqd",
      })}`
    );
    return { result, browserFallbackUsed: true, jsdomAttempts: 0 };
  } catch (browserError) {
    const err = browserError instanceof Error ? browserError : new Error(String(browserError));
    console.error("[Duck.ai] Browser challenge failed:", err.message);
    console.error(
      `[Duck.ai][challenge] ${JSON.stringify({
        browserFallbackUsed: true, finalOutcome: "error", jsdomAttempts: 0, phase: "vqd", retryClass: "challenge",
      })}`
    );
    throw new Error(`Duck.ai browser challenge failed: ${err.message}`);
  }
}

async function solveVqdWithJsdom(challengeB64: string): Promise<VqdSolveOutcome> {
  let lastError: Error | null = null;
  let lastChallengeHash: string | null = null;

  for (let attempt = 1; attempt <= JSDOM_MAX_RETRIES; attempt++) {
    try {
      const useDeobfuscation = attempt > 1;
      const result = await solveVqdChallenge(challengeB64, useDeobfuscation);
      console.log(
        `[Duck.ai][challenge] ${JSON.stringify({
          browserFallbackUsed: false, finalOutcome: "success", jsdomAttempts: attempt, phase: "vqd",
        })}`
      );
      return { result, browserFallbackUsed: false, jsdomAttempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      lastChallengeHash = challengeB64;

      if (isJsdomUnavailableError(lastError)) {
        console.warn("[Duck.ai] jsdom is unavailable in this runtime.");
        break;
      }

      if (!lastError.message.includes("Challenge execution failed")) throw lastError;

      if (attempt < JSDOM_MAX_RETRIES) {
        const delayMs = 1500 * attempt;
        console.warn(
          `[Duck.ai][challenge] ${JSON.stringify({
            browserFallbackUsed: false, delayMs, finalOutcome: "retrying",
            jsdomAttempts: attempt, phase: "vqd", retryClass: "challenge",
          })}`
        );
        await sleep(delayMs);
      }
    }
  }

  console.error(
    `[Duck.ai][challenge] ${JSON.stringify({
      browserFallbackUsed: false, finalOutcome: "error",
      jsdomAttempts: JSDOM_MAX_RETRIES, phase: "vqd", retryClass: "challenge",
    })}`
  );
  throw new Error(
    `VQD challenge failed after ${JSDOM_MAX_RETRIES} explicit jsdom-dangerous attempts. ` +
      `Last jsdom error: ${lastError?.message}. Last challenge hash present: ${Boolean(lastChallengeHash)}`
  );
}

export async function solveVqdChallengeMultiLayer(
  challengeB64: string,
  runtimeOverride?: DuckAiChallengeRuntime,
  cookies?: string
): Promise<VqdSolveOutcome> {
  const runtime = runtimeOverride ?? getDuckAiChallengeRuntime();

  if (runtime === "off") {
    throw new Error(
      "Duck.ai VQD challenge runtime is disabled. Set DUCKAI_BROWSER_WS_ENDPOINT " +
        "or DUCKAI_CHALLENGE_RUNTIME=browser to keep Duck.ai enabled safely."
    );
  }

  if (runtime === "browser") return solveVqdWithBrowser(challengeB64, cookies);
  return solveVqdWithJsdom(challengeB64);
}


