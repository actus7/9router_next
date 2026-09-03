import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Translator | ModelHub",
  description: "Translate and convert API request and response payloads",
};

export default function TranslatorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
