import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";
import { getI18nProps } from "@/i18n/server";
import { ACCENT_COLOR_COOKIE, isValidAccentColor } from "@/shared/constants/accentColors";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ModelHub - AI Infrastructure Management",
  description:
    "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read locale and translations on the server to prevent hydration mismatches
  const { locale, translations } = await getI18nProps();

  // Read the accent color preference on the server too, so <html> is painted
  // with the right data-accent attribute on first byte — no flash, no client script.
  const cookieStore = await cookies();
  const rawAccent = cookieStore.get(ACCENT_COLOR_COOKIE)?.value;
  const accent = isValidAccentColor(rawAccent) && rawAccent !== "default" ? rawAccent : undefined;

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      data-accent={accent}
      className={`${inter.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col font-sans">
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
