// Neutrality injector: appends the ideological-neutrality instruction into the
// system message of the final request body, just before dispatch to the provider executor.

import { injectSystemPrompt } from "./systemInject";
import { NEUTRALITY_PROMPTS } from "./neutralityPrompt";

export function injectNeutrality(body: Record<string, unknown>, format: string, level: string) {
  injectSystemPrompt(body, format, NEUTRALITY_PROMPTS[level]);
}
