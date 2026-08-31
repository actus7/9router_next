/**
 * Leaf module: resolveKiroEffortPath — extracted from kiroConstants.ts to
 * break the circular dependency cycle
 *   kiroConstants → thinkingUnified → thinkingLevels → kiroConstants.
 *
 * This module has NO imports from the engine; it is a pure string helper.
 */

export function resolveKiroEffortPath(model: string) {
  if (typeof model !== "string") return null;
  const normalized = model.toLowerCase().replace(/-/g, ".");
  if (/(?:^|[/.])gpt[/.]5[/.]6(?:[/.]|$)/.test(normalized)) {
    return "reasoning";
  }
  if (!normalized.includes("claude")) return null;
  const match = normalized.match(/(?:^|[/.])claude(?:[/.][a-z]+)*[/.](\d+)(?:[/.](\d+))?(?:[/.]|$)/);
  if (!match) return null;
  const [, majorText, minorText] = match;
  const major = Number(majorText);
  const minor = minorText === undefined ? null : Number(minorText);
  const dateSuffixMinor = minor !== null && minor >= 1000;
  // Kiro rejected additionalModelRequestFields on legacy 4.5 models in live smoke.
  // Default future Claude/Kiro models to supported so new model releases do not
  // need a code allowlist update.
  return major < 4 || (major === 4 && (minor === null || minor <= 5 || dateSuffixMinor))
    ? null
    : "output_config";
}
