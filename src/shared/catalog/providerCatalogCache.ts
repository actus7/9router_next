"use cache";

import { cacheLife } from "next/cache";
import { AI_PROVIDERS } from "@/shared/constants/providers";

export async function getCachedProviderCatalogIds(): Promise<string[]> {
  cacheLife("days");
  return Object.keys(AI_PROVIDERS).sort();
}
