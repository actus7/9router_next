import { tenantRoute } from "@/server/application/http/tenantRoute";
import { getUsageStats, statsEmitter, statsEventName, getActiveRequests } from "@/lib/usageDb";
import { currentTenantId, withTenant } from "@/lib/db/tenant";


async function handleGET() {
  const encoder = new TextEncoder();
  const state: {
    closed: boolean;
    keepalive: ReturnType<typeof setInterval> | null;
    send: (() => Promise<void>) | null;
    sendPending: (() => Promise<void>) | null;
    cachedStats: Record<string, unknown> | null;
  } = { closed: false, keepalive: null, send: null, sendPending: null, cachedStats: null };

  // Captured here, inside tenantRoute's context. Everything below runs later —
  // from an EventEmitter callback or a keepalive timer — where the ambient
  // tenant is whoever happened to trigger it, not whoever opened this stream.
  const owner: string = currentTenantId();
  const updateEvent: string = statsEventName("update", owner);
  const pendingEvent: string = statsEventName("pending", owner);

  const stream = new ReadableStream({
    async start(controller) {
      // Full stats refresh (heavy) + immediate lightweight push
      state.send = async () => {
        if (state.closed) return;
        try {
          await withTenant(owner, async () => {
            // Push lightweight update immediately so UI reflects changes fast
            if (state.cachedStats) {
              const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
              const quickStats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
            }
            // Then do full recalc and update cache
            const stats = await getUsageStats();
            state.cachedStats = stats as unknown as Record<string, unknown>;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
          });
        } catch {
          state.closed = true;
          statsEmitter.off(updateEvent, state.send!);
          statsEmitter.off(pendingEvent, state.sendPending!);
          if (state.keepalive) clearInterval(state.keepalive);
        }
      };

      // Lightweight push: only refresh activeRequests + recentRequests on pending changes
      state.sendPending = async () => {
        if (state.closed || !state.cachedStats) return;
        try {
          await withTenant(owner, async () => {
            const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
            const stats = { ...state.cachedStats, activeRequests, recentRequests, errorProvider };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
          });
        } catch {
          state.closed = true;
          statsEmitter.off(updateEvent, state.send!);
          statsEmitter.off(pendingEvent, state.sendPending!);
          if (state.keepalive) clearInterval(state.keepalive);
        }
      };

      await state.send!();

      statsEmitter.on(updateEvent, state.send!);
      statsEmitter.on(pendingEvent, state.sendPending!);

      state.keepalive = setInterval(() => {
        if (state.closed) { if (state.keepalive) clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          if (state.keepalive) clearInterval(state.keepalive);
        }
      }, 25000);
    },

    cancel() {
      state.closed = true;
      if (state.send) statsEmitter.off(updateEvent, state.send);
      if (state.sendPending) statsEmitter.off(pendingEvent, state.sendPending);
      if (state.keepalive) clearInterval(state.keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const GET = tenantRoute(handleGET);
