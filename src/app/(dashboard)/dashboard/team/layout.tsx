import type { Metadata } from "next";
import { localizedMetadata } from "@/i18n/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata(
    "Team | ModelHub",
    "Members, invitations and what each person and key can use",
  );
}

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return children;
}
