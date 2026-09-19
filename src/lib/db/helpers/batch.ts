/**
 * Writing a list to Postgres in statements, not in round-trips.
 *
 * Every `db.run` is one network hop to Neon — measured at ~180ms from a dev
 * machine. A loop of them inside a transaction turns a 400-row write into a
 * minute of held transaction, which is how "Refresh Models" and "Disable all"
 * both came to look like the app had frozen.
 *
 * 250 rows per statement keeps the parameter count well under Postgres's 65535
 * limit even for a six-column row, and makes any realistic list one or two
 * statements.
 */
export const SQL_BATCH_ROWS = 250;

export function chunked<T>(items: readonly T[], size: number = SQL_BATCH_ROWS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** `?, ?, ?` — for an `IN (...)` list. */
export function placeholderList(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * Repeats a row template for a multi-row `VALUES`.
 *
 * The template is written out per call — `"(?, 'customModels', ?, ?)"` — rather
 * than derived from a column count, because a row often mixes parameters with
 * a literal the whole batch shares, and spelling it out reads closer to the SQL
 * it lands in.
 */
export function valuesRows(rowCount: number, rowTemplate: string): string {
  return Array.from({ length: rowCount }, () => rowTemplate).join(", ");
}
