import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";
import { I18nBootstrapScript } from "@/i18n/I18nBootstrapScript";
import { getI18nProps } from "@/i18n/server";
import { assertRequestRuntime } from "@/server/application/http/requestRuntime";
import { readAccentColorAttribute } from "./accentColor.server";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

/**
 * The locale cookie decides every literal rendered below this point, so the
 * shell cannot be prerendered with a placeholder locale: doing so ships English
 * HTML that the client then re-renders translated, which React reports as a
 * hydration mismatch. Resolving at request time keeps SSR and hydration equal.
 */
export async function RootShell({ children }: { children: React.ReactNode }) {
  await assertRequestRuntime();
  const [{ locale, translations }, accent] = await Promise.all([
    getI18nProps(),
    readAccentColorAttribute(),
  ]);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      data-accent={accent}
      className={`${inter.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col font-sans">
        <I18nBootstrapScript locale={locale} translations={translations} />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <RuntimeI18nProvider locale={locale} translations={translations}>
            <TooltipProvider>{children}</TooltipProvider>
          </RuntimeI18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
