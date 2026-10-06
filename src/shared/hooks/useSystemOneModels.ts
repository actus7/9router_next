"use client";

import useSWR from "swr";
import { jsonFetcher } from "./jsonFetcher";

export interface SystemOneModelView {
  id: string;
  name: string;
  description: string | null;
}

export interface SystemOneModelsResponse {
  models: SystemOneModelView[];
  source: "gateway" | "builtin";
  error?: "no_key" | "http" | "network" | "empty";
}

/** The System One (typed-decision) models the account's AI Gateway key can use. */
export function useSystemOneModels() {
  return useSWR<SystemOneModelsResponse>("/api/system-one/models", jsonFetcher, { revalidateOnFocus: false });
}
