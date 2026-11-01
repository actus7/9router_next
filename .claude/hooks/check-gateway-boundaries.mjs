// Roda os testes de fronteira arquitetural quando um arquivo do LLM gateway é editado.
// Chamado pelo hook PostToolUse em .claude/settings.json; o Claude Code manda o input como JSON no stdin.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function editedPath() {
  if (process.argv[2]) return process.argv[2];
  try {
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    return input?.tool_input?.file_path || input?.tool_input?.path || "";
  } catch { return ""; }
}

const normalized = editedPath().replace(/\\/g, "/");
if (/\/(server\/llm-gateway|shared\/llm-catalog|app\/api)\//.test(normalized)) {
  try {
    execFileSync("npm", ["run", "test", "--", "architectureGates", "dashboardGuard"], { stdio: ["ignore", "inherit", "inherit"], shell: true });
  } catch {
    console.error("Testes de fronteira falharam (architectureGates/dashboardGuard). Ver saída acima.");
    process.exit(2);
  }
}