import { translate } from "@/i18n/runtime";
import type { AccessField, AccessPolicy } from "@/shared/access/accessPolicy";

const t = (text: string): string => translate(text) || text;

const NOUNS: Record<AccessField, { one: string; many: string }> = {
  models: { one: "model", many: "models" },
  plugins: { one: "plugin", many: "plugins" },
  skills: { one: "skill", many: "skills" },
};

/**
 * One line for a list row: what the policy limits, or that it limits nothing.
 * "2 models · no skills" reads at a glance; the dialog has the detail.
 */
export function summarizeAccess(policy: AccessPolicy, fields: readonly AccessField[]): string {
  const parts = fields
    .filter((field) => policy[field] !== undefined)
    .map((field) => {
      const count = policy[field]!.length;
      const noun = NOUNS[field];
      if (count === 0) return `${t("no")} ${t(noun.many)}`;
      return `${count} ${t(count === 1 ? noun.one : noun.many)}`;
    });
  if (policy.limits?.rpm) parts.push(`${policy.limits.rpm} ${t("req/min")}`);
  if (policy.limits?.monthlyBudgetUsd) parts.push(`US$ ${policy.limits.monthlyBudgetUsd}/${t("month")}`);
  return parts.length === 0 ? t("Full access") : parts.join(" · ");
}

export function isRestricted(policy: AccessPolicy, fields: readonly AccessField[]): boolean {
  return fields.some((field) => policy[field] !== undefined) || policy.limits !== undefined;
}
