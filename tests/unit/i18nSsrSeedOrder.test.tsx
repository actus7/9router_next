import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

const { RuntimeI18nProvider } = await import("@/i18n/RuntimeI18nProvider");
const { translate } = await import("@/i18n/runtime");

function Probe() {
  return <div aria-label={translate("Notifications") ?? undefined} />;
}

/**
 * `translate()` reads module-level state seeded by `RuntimeI18nProvider`. If the
 * provider seeded after its children rendered, SSR would emit English while the
 * browser hydrated with the cookie locale, which React reports as an attribute
 * hydration mismatch.
 */
describe("server render seeds i18n before children", () => {
  it("renders translated attributes in the server markup", () => {
    const markup = renderToStaticMarkup(
      <RuntimeI18nProvider locale="pt-BR" translations={{ Notifications: "Notificações" }}>
        <Probe />
      </RuntimeI18nProvider>,
    );
    expect(markup).toContain('aria-label="Notificações"');
  });

  it("keeps English markup for the default locale", () => {
    const markup = renderToStaticMarkup(
      <RuntimeI18nProvider locale="en" translations={{}}>
        <Probe />
      </RuntimeI18nProvider>,
    );
    expect(markup).toContain('aria-label="Notifications"');
  });
});
