import { describe, expect, it } from "vitest";
import { seedRuntimeI18n, translate } from "@/i18n/runtime";

describe("seedRuntimeI18n", () => {
  it("applies server translations before translate() runs", () => {
    seedRuntimeI18n("pt-BR", { Notifications: "Notificações" });
    expect(translate("Notifications")).toBe("Notificações");
  });

  it("keeps English literals when locale is en", () => {
    seedRuntimeI18n("en", {});
    expect(translate("Notifications")).toBe("Notifications");
  });
});
