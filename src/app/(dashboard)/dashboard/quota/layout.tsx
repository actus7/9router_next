import type { Metadata } from "next";
import { localizedMetadata } from "@/i18n/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata(
    "Quota | ModelHub",
    "View and manage provider usage limits",
  );
}

export default function QuotaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
