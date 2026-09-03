import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Token Saver | ModelHub",
  description: "Configure token optimization settings",
};

export default function TokenSaverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
