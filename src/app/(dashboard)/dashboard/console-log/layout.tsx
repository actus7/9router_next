import type { Metadata } from "next";
import { localizedMetadata } from "@/i18n/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata(
    "Console Log | ModelHub",
    "View server console output and runtime logs",
  );
}

export default function ConsoleLogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
