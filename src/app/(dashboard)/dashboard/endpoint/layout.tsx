import type { Metadata } from "next";
import { localizedMetadata } from "@/i18n/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return localizedMetadata(
    "Endpoint | ModelHub",
    "Configure API endpoint, tunnels, and API keys",
  );
}

export default function EndpointLayout({ children }: { children: React.ReactNode }) {
  return children;
}
