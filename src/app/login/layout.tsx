import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In | ModelHub",
  description: "Sign in to access the ModelHub dashboard",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
