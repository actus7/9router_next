import type { Metadata } from "next";
import { RootShell } from "@/app/RootShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "ModelHub - AI Infrastructure Management",
  description:
    "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/apple-icon.png",
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
};

// The shell resolves the locale cookie before rendering any literal, so every
// route blocks on the request. Streaming a placeholder locale instead would
// prerender English HTML and break hydration for non-English users.
export const instant = false;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RootShell>{children}</RootShell>;
}
