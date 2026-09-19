import type { Metadata } from "next";
import { localizedMetadata } from "@/i18n/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata(
    "Translator | ModelHub",
    "Translate and convert API request and response payloads",
  );
}

export default function TranslatorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
