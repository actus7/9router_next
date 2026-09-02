import { AntigravityExecutor } from "./antigravity";
import { AzureExecutor } from "./azure";
import { GeminiCLIExecutor } from "./gemini-cli";
import { GithubExecutor } from "./github";
import { IFlowExecutor } from "./iflow";
import { QoderExecutor } from "./qoder";
import { KiroExecutor } from "./kiro";
import { KimchiExecutor } from "./kimchi";
import { CodexExecutor } from "./codex";
import { CursorExecutor } from "./cursor";
import { VertexExecutor } from "./vertex";
import { OpenCodeExecutor } from "./opencode";
import { GrokCliExecutor } from "./grok-cli";
import { CommandCodeExecutor } from "./commandcode";
import { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan";
import { MimoFreeExecutor } from "./mimo-free";
import { CodeBuddyExecutor } from "./codebuddy-cn";
import { CodeBuddyIntlExecutor } from "./codebuddy-intl";
import TraeExecutor from "./trae";
import ZedExecutor from "./zed";
import WindsurfExecutor from "./windsurf";
import { DefaultExecutor } from "./default";
import { PuterExecutor } from "./puter";
import { DevinCliExecutor } from "./devin-cli";
import { GithubCopilotExecutor } from "./github-copilot";
import { QuillbotExecutor } from "./quillbot";
import { DuckAiExecutor } from "./duckai";
import { Context7Executor } from "./context7";
import { AnySearchExecutor } from "./anysearch";
import { ModelScopeExecutor } from "./modelscope";
import { AIHordeExecutor } from "./aihorde";
import { DeepSeekWebExecutor } from "./deepseek-web";
import { CopilotWebExecutor } from "./copilot-web";
import { HuggingChatExecutor } from "./huggingchat";
import { PoeWebExecutor } from "./poe-web";
import { T3WebExecutor } from "./t3-web";
import { BlackboxWebExecutor } from "./blackbox-web";
import { MuseSparkWebExecutor } from "./muse-spark-web";
import { KimiWebExecutor } from "./kimi-web";
import { VeniceWebExecutor } from "./venice-web";
import { YuanbaoWebExecutor } from "./yuanbao-web";
import { TencentAistudioWebExecutor } from "./tencent-aistudio-web";
import { CopilotM365WebExecutor } from "./copilot-m365-web";
import { AdaptaWebExecutor } from "./adapta-web";
import { InnerAiExecutor } from "./inner-ai";
import { HyperAgentExecutor } from "./hyperagent";
import { ConolWebExecutor } from "./conol-web";
import { PromptQLExecutor } from "./promptql";
import { ZaiWebExecutor } from "./zai-web";
import { GeminiBusinessExecutor } from "./gemini-business";
import { V0VercelWebExecutor } from "./v0-vercel-web";
import { AdobeFireflyExecutor } from "./adobe-firefly";
import { ZenmuxFreeExecutor } from "./zenmux-free";
import { TheOldLLMExecutor } from "./theoldllm";

const executors = {
  antigravity: new AntigravityExecutor(),
  azure: new AzureExecutor(),
  "gemini-cli": new GeminiCLIExecutor(),
  github: new GithubExecutor(),
  iflow: new IFlowExecutor(),
  qoder: new QoderExecutor(),
  kiro: new KiroExecutor(),
  "amazon-q": new KiroExecutor("amazon-q"),
  kimchi: new KimchiExecutor(),
  codex: new CodexExecutor(),
  cursor: new CursorExecutor(),
  cu: new CursorExecutor(), // Alias for cursor
  vertex: new VertexExecutor("vertex"),
  "vertex-partner": new VertexExecutor("vertex-partner"),
  opencode: new OpenCodeExecutor(),
  "grok-cli": new GrokCliExecutor(),
  gcli: new GrokCliExecutor(), // Alias
  gb: new GrokCliExecutor(), // Alias (Grok Build)
  commandcode: new CommandCodeExecutor(),
  "xiaomi-tokenplan": new XiaomiTokenplanExecutor(),
  "mimo-free": new MimoFreeExecutor(),
  mmf: new MimoFreeExecutor(), // Alias for mimo-free
  "codebuddy-cn": new CodeBuddyExecutor(),
  "codebuddy-intl": new CodeBuddyIntlExecutor(),
  trae: new TraeExecutor(),
  zed: new ZedExecutor(),
  windsurf: new WindsurfExecutor(),
  "devin-cli": new DevinCliExecutor(),
  "github-copilot": new GithubCopilotExecutor(),
  "ghe-copilot": new GithubCopilotExecutor("ghe-copilot"),
  quillbot: new QuillbotExecutor(),
  duckai: new DuckAiExecutor(),
  context7: new Context7Executor(),
  anysearch: new AnySearchExecutor(),
  modelscope: new ModelScopeExecutor(),
  aihorde: new AIHordeExecutor(),
  "deepseek-web": new DeepSeekWebExecutor(),
  "copilot-web": new CopilotWebExecutor(),
  huggingchat: new HuggingChatExecutor(),
  "poe-web": new PoeWebExecutor(),
  "t3-web": new T3WebExecutor(),
  "blackbox-web": new BlackboxWebExecutor(),
  "muse-spark-web": new MuseSparkWebExecutor(),
  "kimi-web": new KimiWebExecutor(),
  "venice-web": new VeniceWebExecutor(),
  "yuanbao-web": new YuanbaoWebExecutor(),
  "tencent-aistudio-web": new TencentAistudioWebExecutor(),
  "copilot-m365-web": new CopilotM365WebExecutor(),
  "adapta-web": new AdaptaWebExecutor(),
  "inner-ai": new InnerAiExecutor(),
  hyperagent: new HyperAgentExecutor(),
  "conol-web": new ConolWebExecutor(),
  promptql: new PromptQLExecutor(),
  "zai-web": new ZaiWebExecutor(),
  "gemini-business": new GeminiBusinessExecutor(),
  "v0-vercel-web": new V0VercelWebExecutor(),
  "adobe-firefly": new AdobeFireflyExecutor(),
  "zenmux-free": new ZenmuxFreeExecutor(),
  theoldllm: new TheOldLLMExecutor(),
  puter: new PuterExecutor(),
};

export { executors };

const defaultCache = new Map();

export function getExecutor(provider: string) {
  if ((executors as Record<string, unknown>)[provider]) return (executors as Record<string, unknown>)[provider];
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider);
}

export function hasSpecializedExecutor(provider: string) {
  return !!(executors as Record<string, unknown>)[provider];
}

export { default as TraeExecutor } from "./trae";
export { default as ZedExecutor } from "./zed";
export { default as WindsurfExecutor } from "./windsurf";
