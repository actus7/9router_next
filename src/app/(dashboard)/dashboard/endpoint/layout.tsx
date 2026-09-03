import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Endpoint | ModelHub",
  description: "Configure API endpoint, tunnels, and API keys",
};

export default function EndpointLayout({ children }: { children: React.ReactNode }) {
  return children;
}
