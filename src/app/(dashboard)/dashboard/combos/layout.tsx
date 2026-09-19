import type { Metadata } from "next";
import { localizedMetadata } from "@/i18n/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata(
    "Combos | ModelHub",
    "Manage model combos with fallback support",
  );
}

export default function CombosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
