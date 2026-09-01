import ora, { Ora } from "ora";

/**
 * UI Helper Functions
 */






export function spinner(text: string): Ora {
  return ora(text);
}
