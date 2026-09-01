import { resolveKiroModel } from "../config/kiroConstants";
import { getCapabilitiesForModel } from "../providers/capabilities";
import { SSE_HEADERS } from "../utils/sseConstants";
import {
  encoder,
  encodeSSEError,
  failTransform,
  makeDiagnostics,
  type EventStreamState,
  type TransformContext,
  type TransformOptions,
} from "./kiroEventStreamCore";
import { finishStream, processBytes } from "./kiroEventStreamFinalizer";

export function transformKiroEventStreamToSSE(response: Response, model: string, options: TransformOptions = {}): Response {
    const responseId = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const capabilityModel = resolveKiroModel(model).upstream;
    const contextWindow = getCapabilitiesForModel("kiro", capabilityModel).contextWindow || 200000;
    const eventCounts: Record<string, number> = {};
    const state: EventStreamState = {
      buffer: new Uint8Array(0),
      chunkIndex: 0,
      toolCounter: 0,
      tools: new Map(),
      bufferedToolBytes: 0,
      hasText: false,
      hasReasoning: false,
      hasCode: false,
      hasToolCalls: false,
      sawToolUse: false,
      explicitStop: false,
      stopReason: null,
      terminalProvenance: null,
      transportState: "consuming_response",
      totalContentLength: 0,
      contextUsagePercentage: 0,
      hasContextUsage: false,
      hasMetering: false,
      usage: null,
      inThinking: false,
      toolValidationError: null,
      validatedFrames: 0,
      finished: false
    };
    const ctx: TransformContext = { state, options, responseId, created, model, contextWindow, eventCounts };

    if (!response.body) {
      const detail = makeDiagnostics(ctx, {
        terminal_provenance: "missing_response_body",
        transport_state: "missing_body",
        stop_disposition: "terminal_incomplete"
      });
      options.onTerminalState?.(detail);
      return new Response(encodeSSEError(
        "kiro_missing_terminal",
        "Kiro response did not include an EventStream body",
        detail
      ) as unknown as BodyInit, { status: response.status, headers: { ...SSE_HEADERS } });
    }

    const reader = response.body.getReader();
    const stream = new ReadableStream({
      start: async (controller: ReadableStreamDefaultController<Uint8Array>) => {
        try {
          while (!state.finished) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunksBefore = state.chunkIndex;
            const framesBefore = state.validatedFrames;
            if (!processBytes(value, controller, ctx)) {
              await reader.cancel("invalid Kiro EventStream").catch(() => {});
              break;
            }
            if (state.validatedFrames > framesBefore && state.chunkIndex === chunksBefore) {
              controller.enqueue(encoder.encode(": kiro-upstream\n\n"));
            }
          }
          finishStream(ctx, controller);
          controller.close();
        } catch (e: unknown) {
          const error = e instanceof Error ? e : new Error(String(e));
          if (!state.finished) {
            failTransform(
              ctx,
              controller,
              "upstream_read_error",
              "kiro_missing_terminal",
              error.message || "Kiro EventStream read failed",
              { transport_state: "upstream_error" }
            );
          }
          controller.close();
        }
      },
      cancel(reason: unknown) {
        return reader.cancel(reason);
      }
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: { ...SSE_HEADERS }
    });
  }


