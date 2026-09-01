import { dynamicImport } from "./duckaiOptionalDependency";
import { DUCKAI_USER_AGENT, type VqdChallengeResult } from "./duckaiChallengeTypes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PuppeteerBrowser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PuppeteerPage = any;

let warmBrowser: PuppeteerBrowser | null = null;
let warmBrowserTimeout: ReturnType<typeof setTimeout> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let puppeteerModulePromise: Promise<any> | null = null;
let warmBrowserIsRemote = false;
const BROWSER_IDLE_MS = 5 * 60 * 1000; // close after 5 min idle

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPuppeteerModule(): Promise<any> {
  if (!puppeteerModulePromise) {
    puppeteerModulePromise = (async () => {
      try {
        return await dynamicImport("puppeteer");
      } catch {
        try {
          // Fallback to puppeteer-core (smaller, no bundled browser)
          return await dynamicImport("puppeteer-core");
        } catch {
          throw new Error(
            "Neither 'puppeteer' nor 'puppeteer-core' is installed. " +
              "Run: npm install puppeteer-core  (or: npm install puppeteer)"
          );
        }
      }
    })();
    // Don't cache a rejected promise — allow a later call to retry the load
    puppeteerModulePromise.catch(() => { puppeteerModulePromise = null; });
  }
  return puppeteerModulePromise;
}

function getBrowserLaunchArgs(): string[] {
  const args = ["--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions"];
  if (process.env.DUCKAI_PUPPETEER_NO_SANDBOX === "true") {
    args.unshift("--no-sandbox", "--disable-setuid-sandbox");
  }
  return args;
}

async function getWarmBrowser(): Promise<PuppeteerBrowser> {
  // Reset idle timer every time the browser is used
  if (warmBrowserTimeout) clearTimeout(warmBrowserTimeout);
  warmBrowserTimeout = setTimeout(() => {
    const browser = warmBrowser;
    if (warmBrowserIsRemote) {
      browser?.disconnect();
    } else {
      browser?.close().catch(() => {});
    }
    warmBrowser = null;
    warmBrowserIsRemote = false;
    warmBrowserTimeout = null;
    console.log("[Duck.ai] Warm browser closed (idle timeout)");
  }, BROWSER_IDLE_MS);

  if (warmBrowser && warmBrowser.connected) return warmBrowser;

  const puppeteer = await getPuppeteerModule();
  const browserWsEndpoint = process.env.DUCKAI_BROWSER_WS_ENDPOINT?.trim();
  if (browserWsEndpoint) {
    console.log("[Duck.ai] Connecting to remote browser for VQD challenge...");
    warmBrowser = await puppeteer.connect({ browserWSEndpoint: browserWsEndpoint });
    warmBrowserIsRemote = true;
    return warmBrowser;
  }

  console.log("[Duck.ai] Launching warm Puppeteer browser...");
  warmBrowser = await puppeteer.launch({
    headless: true,
    args: getBrowserLaunchArgs(),
  });
  warmBrowserIsRemote = false;
  return warmBrowser;
}

export async function solveVqdChallengeWithBrowser(
  challengeB64: string,
  cookies?: string
): Promise<VqdChallengeResult> {
  const decoded = Buffer.from(challengeB64, "base64").toString("utf-8");
  const browser = await getWarmBrowser();
  let page: PuppeteerPage | null = null;

  try {
    page = await browser.newPage();
    await page.setUserAgent(DUCKAI_USER_AGENT);
    await page.setJavaScriptEnabled(true);

    // Navigate to duck.ai so the challenge script has the correct origin context
    await page.goto("https://duck.ai/", { waitUntil: "domcontentloaded" });

    // Set session cookies so the challenge script can access them
    if (cookies) {
      const cookiePairs = cookies.split(/;\s*/).filter(Boolean);
      for (const pair of cookiePairs) {
        const eqIdx = pair.indexOf("=");
        if (eqIdx < 1) continue;
        const name = pair.slice(0, eqIdx);
        const value = pair.slice(eqIdx + 1);
        await page.setCookie({ name, value, domain: "duck.ai", path: "/" }).catch(() => {});
      }
    }

    // Execute the challenge in the browser context
    const result = await page.evaluate(async (script: string) => {
      try {
        const fn = eval(`(${script})`);
        const res = typeof fn === "function" ? await fn() : await fn;
        return { ok: true as const, data: res };
      } catch (e) {
        return { ok: false as const, error: (e as Error).message };
      }
    }, decoded);

    if (!result.ok) {
      throw new Error(`Browser challenge failed: ${result.error}`);
    }

    const data = result.data as VqdChallengeResult;
    if (!data?.server_hashes || !data?.client_hashes) {
      console.error("[Duck.ai] Challenge result missing fields:", {
        hasServerHashes: !!data?.server_hashes,
        hasClientHashes: !!data?.client_hashes,
        hasSignals: !!data?.signals,
        hasMeta: !!data?.meta,
        keys: data ? Object.keys(data) : [],
      });
      throw new Error("Browser challenge returned invalid data (missing server_hashes or client_hashes)");
    }

    return data;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------

