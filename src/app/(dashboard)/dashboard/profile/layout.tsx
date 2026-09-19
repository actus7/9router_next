import type { Metadata } from "next";
import { localizedMetadata } from "@/i18n/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata(
    "Settings | ModelHub",
    "Manage application settings and security",
  );
}

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
