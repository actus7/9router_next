import { getAdapter } from "../driver";
import { parseJson, stringifyJson } from "../helpers/jsonCol";
import { makeKv } from "../helpers/kvStore";

const aliasKv = makeKv("modelAliases");
const customKv = makeKv("customModels");
const mitmKv = makeKv("mitmAlias");

// modelAliases: key=alias, value=modelString
export async function getModelAliases(): Promise<Record<string, unknown>> {
  return await aliasKv.getAll();
}

export async function setModelAlias(alias: string, model: unknown): Promise<void> {
  await aliasKv.set(alias, model);
}

export async function deleteModelAlias(alias: string): Promise<void> {
  await aliasKv.remove(alias);
}

// customModels: key=`${providerAlias}|${id}|${type}`, value=full model object
function customKey(providerAlias: string, id: string, type: string): string {
  return `${providerAlias}|${id}|${type}`;
}

export async function getCustomModels(): Promise<unknown[]> {
  const all: Record<string, unknown> = await customKv.getAll();
  return Object.values(all);
}

interface CustomModelInput {
  providerAlias: string;
  id: string;
  type?: string;
  name?: string;
}

// Atomic check-then-insert inside transaction to prevent duplicate races
export async function addCustomModel({ providerAlias, id, type = "llm", name }: CustomModelInput): Promise<boolean> {
  const k: string = customKey(providerAlias, id, type);
  const db = await getAdapter();
  let added: boolean = false;
  db.transaction(() => {
    const row: Record<string, unknown> | undefined = db.get(`SELECT 1 FROM kv WHERE scope = 'customModels' AND key = ?`, [k]);
    if (row) return;
    const value: string = stringifyJson({ providerAlias, id, type, name: name || id });
    db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, value]);
    added = true;
  });
  return added;
}

interface CustomModelDeleteInput {
  providerAlias: string;
  id: string;
  type?: string;
}

export async function deleteCustomModel({ providerAlias, id, type = "llm" }: CustomModelDeleteInput): Promise<void> {
  await customKv.remove(customKey(providerAlias, id, type));
}

// mitmAlias: key=toolName, value=mappings object
export async function getMitmAlias(toolName?: string): Promise<Record<string, unknown> | unknown> {
  if (toolName) {
    const v: unknown = await mitmKv.get(toolName);
    return v || {};
  }
  return await mitmKv.getAll();
}

export async function setMitmAliasAll(toolName: string, mappings: Record<string, unknown>): Promise<void> {
  await mitmKv.set(toolName, mappings || {});
}
