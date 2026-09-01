// Roda os testes de fronteira arquitetural quando um arquivo do LLM gateway é editado.
// Chamado pelo hook PostToolUse em .claude/settings.json.
const rawPath = process.argv[2] || process.env.FILE_PATH || '';
const normalized = rawPath.replace(/\\/g, '/');
const boundaryPattern = /\/(server\/llm-gateway|shared\/llm-catalog|app\/api)\//;

if (boundaryPattern.test(normalized)) {
  const { execFileSync } = require('child_process');
  try {
    execFileSync('npm', ['run', 'test', '--', 'architectureGates', 'dashboardGuard'], { stdio: 'inherit' });
  } catch {
    process.exit(1);
  }
}
