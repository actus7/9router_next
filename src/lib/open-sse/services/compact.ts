/**
 * Shared combo (model combo) handling with fallback support
 */

import type { ComboEntry, CombosData } from "./types";

/**
 * Get combo models from combos data
 * @param modelStr - Model string to check
 * @param combosData - Array of combos or object with combos
 * @returns Array of models or null if not a combo
 */
export function getComboModelsFromData(modelStr: string, combosData: ComboEntry[] | CombosData) {
  // Don't check if it's in provider/model format
  if (modelStr.includes("/")) return null;
  
  // Handle both array and object formats
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  
  const combo = combos.find(c => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

/**
 * Handle combo chat with fallback
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {string[]} options.models - Array of model strings to try
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @returns {Promise<Response>}
 */
export async function handleComboChat({ body, models, handleSingleModel, log }: {
  body: Record<string, unknown>;
  models: string[];
  handleSingleModel: (body: Record<string, unknown>, modelStr: string) => Promise<Response>;
  log: { info: (tag: string, msg: string, meta?: unknown) => void; warn: (tag: string, msg: string, meta?: unknown) => void };
}) {
  let lastError = null;

  for (let i = 0; i < models.length; i++) {
    const modelStr = models[i];
    log.info("COMBO", `Trying model ${i + 1}/${models.length}: ${modelStr}`);

    let result;
    try {
      result = await handleSingleModel(body, modelStr);
    } catch (e: unknown) {
      lastError = `${modelStr}: ${e instanceof Error ? e.message : String(e)}`;
      log.warn("COMBO", `Model threw exception, trying next`, { model: modelStr, error: e instanceof Error ? e.message : String(e) });
      continue;
    }

    // Success or client error - return response
    if (result.ok || result.status < 500) {
      return result;
    }

    // 5xx error - try next model
    lastError = `${modelStr}: ${result.statusText || result.status}`;
    log.warn("COMBO", `Model failed, trying next`, { model: modelStr, status: result.status });
  }

  log.warn("COMBO", "All models failed");
  
  // Return 503 with last error
  return new Response(
    JSON.stringify({ error: lastError || "All combo models unavailable" }),
    { 
      status: 503, 
      headers: { "Content-Type": "application/json" }
    }
  );
}

