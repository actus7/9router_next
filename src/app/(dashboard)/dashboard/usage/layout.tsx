import type { Metadata } from "next";
import { localizedMetadata } from "@/i18n/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata(
    "Usage & Analytics | ModelHub",
    "View API usage statistics and analytics",
  );
}

export default function UsageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
