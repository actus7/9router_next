import type { Metadata } from "next";
import { localizedMetadata } from "@/i18n/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata(
    "Token Saver | ModelHub",
    "Configure token optimization settings",
  );
}

export default function TokenSaverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
