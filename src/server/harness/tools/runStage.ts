/**
 * The coarse stage a run is in, shown next to a conversation in the history.
 *
 * Deliberately coarse. The sidebar polls `/api/harness/runs` every 8s, so a
 * per-tool label would routinely name a `web_search` that finished seven
 * seconds ago — worse than saying nothing, because it reads as current. A
 * stage groups the tools that take long enough to still be true when read.
 */
const STAGES: Record<string, string> = {
  web_search: "Pesquisando",
  web_fetch: "Pesquisando",
  search_past_sessions: "Pesquisando",
  generate_image: "Gerando imagem",
  generate_video: "Gerando vídeo",
  text_to_speech: "Gerando áudio",
  load_skill: "Lendo skill",
  load_skill_file: "Lendo skill",
  create_skill: "Escrevendo skill",
  update_skill: "Escrevendo skill",
  patch_skill: "Escrevendo skill",
  learn_skill: "Escrevendo skill",
  memory_add: "Atualizando memória",
  memory_replace: "Atualizando memória",
  memory_remove: "Atualizando memória",
  toggle_plugin: "Ajustando plugins",
};

/** What a run is doing between tools — and what it goes back to after one. */
export const ANSWERING_STAGE = "Respondendo";

export function runStageFor(toolName: string): string {
  return (
    STAGES[toolName] ??
    // An MCP tool's name comes from someone else's server, so it is not ours to
    // show. That it is external is the part worth saying.
    (toolName.startsWith("mcp_") ? "Usando ferramenta externa" : "Usando ferramenta")
  );
}
