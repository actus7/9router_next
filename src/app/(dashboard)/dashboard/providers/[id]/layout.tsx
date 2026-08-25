import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `${id} | 9Router`,
    description: `Manage ${id} provider connections`,
  };
}

export default function ProviderDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
