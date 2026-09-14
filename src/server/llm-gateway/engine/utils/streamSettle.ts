import { FORMATS } from "../translator/formats";
import { trackPendingRequest, appendRequestLog } from "../host/usage";
import { hasValidUsage, estimateUsage, logUsage } from "./usageTracking";
import { STREAM_MODE, type StreamContext } from "./stream";

/**
 * Fecha a conta da requisição: baixa o contador de "em voo" e entrega o usage
 * coletado a quem grava `usageHistory`.
 *
 * Roda no `flush()` **e** no `cancel()` do TransformStream porque um cliente
 * OpenAI-compatível para de ler no primeiro `data: [DONE]` e fecha a conexão —
 * e aí só o `cancel` acontece. Enquanto isso morava só no flush, a requisição
 * respondia certo e não aparecia em lugar nenhum do dashboard, e o provedor
 * ficava marcado como ocupado na topologia até o timeout de pendência. Os dois
 * caminhos podem acontecer na mesma requisição, então isto é idempotente.
 */
export function settleStream(ctx: StreamContext): void {
  if (ctx.settled) return;
  ctx.settled = true;
  // Tudo aqui toca estado por-tenant (contador de pendentes, gravação de
  // usage) e roda fora da requisição — re-entra o dono capturado na criação.
  ctx.reentry(() => settleStreamInTenant(ctx));
}

function settleStreamInTenant(ctx: StreamContext): void {
  const isPassthrough: boolean = ctx.mode === STREAM_MODE.PASSTHROUGH;
  const format: string = isPassthrough ? FORMATS.OPENAI : ctx.sourceFormat!;
  const readUsage = (): Record<string, unknown> | null =>
    (isPassthrough ? ctx.usage : (ctx.state?.usage as Record<string, unknown> | undefined)) ?? null;
  const writeUsage = (value: Record<string, unknown>): void => {
    if (isPassthrough) ctx.usage = value;
    else if (ctx.state) ctx.state.usage = value;
  };

  trackPendingRequest(ctx.model ?? "", ctx.provider ?? "", ctx.connectionId ?? "", false);

  if (!hasValidUsage(readUsage() as Record<string, unknown>) && ctx.totalContentLength > 0) {
    writeUsage(estimateUsage(ctx.body, ctx.totalContentLength, format) as Record<string, unknown>);
  }

  const usage: Record<string, unknown> | null = readUsage();
  if (hasValidUsage(usage as Record<string, unknown>)) {
    logUsage(isPassthrough ? ctx.provider : ((ctx.state?.provider as string) || ctx.targetFormat!), usage!, ctx.model, ctx.connectionId, ctx.apiKey);
  } else {
    appendRequestLog().catch(() => { });
  }

  ctx.onStreamComplete?.({
    content: ctx.accumulatedContent,
    thinking: ctx.accumulatedThinking,
  }, usage, ctx.ttftAt);
}
