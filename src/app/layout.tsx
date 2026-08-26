import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";
import { getI18nProps } from "@/i18n/server";
import "material-symbols/outlined.css";
import "./globals.css";
import "@/lib/network/initOutboundProxy";
import "@/shared/services/bootstrap";
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer";

initConsoleLogCapture();

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "9Router - AI Infrastructure Management",
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

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${inter.variable} h-full antialiased`}
    >
      <head>
        <Script
          id="font-loading"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){document.documentElement.classList.add('fonts-loaded')})}else{document.documentElement.classList.add('fonts-loaded')}`,
          }}
        />
      </head>
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
