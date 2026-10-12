// The catalog's `applicability` rules (see modelparams): `only` / `except`, each
// one match object (AND) or an array of them (OR); a match value is a primitive,
// a list of primitives, or {not: ...}. A missing path never matches. Mirrored
// here, small, so the dialog needn't ship the 1.3 MB catalog package; the server
// still validates and drops with the real one.

type Primitive = string | number | boolean | null;
type MatchValue = Primitive | Primitive[] | { not: Primitive | Primitive[] };
type Match = Record<string, MatchValue>;
export interface Applicability { only?: Match | Match[]; except?: Match | Match[] }

const includes = (expected: Primitive | Primitive[], actual: unknown): boolean =>
  Array.isArray(expected) ? expected.includes(actual as Primitive) : expected === actual;

function matchOne(match: Match, values: Record<string, unknown>): boolean {
  return Object.entries(match).every(([path, expected]) => {
    if (!(path in values) || values[path] === undefined) return false;
    if (typeof expected === "object" && expected !== null && !Array.isArray(expected)) return !includes(expected.not, values[path]);
    return includes(expected, values[path]);
  });
}

const matches = (rule: Match | Match[], values: Record<string, unknown>): boolean =>
  (Array.isArray(rule) ? rule : [rule]).some((match) => matchOne(match, values));

/** Whether a parameter is available given the effective values (defaults under what the user set). */
export function isParamApplicable(rule: Applicability | undefined, values: Record<string, unknown>): boolean {
  if (!rule) return true;
  if (rule.only && !matches(rule.only, values)) return false;
  if (rule.except && matches(rule.except, values)) return false;
  return true;
}
