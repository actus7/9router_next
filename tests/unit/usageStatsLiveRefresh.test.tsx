// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O bug: o SSE de /api/usage/stream entrega estatísticas do período "all"
// (getUsageStats() sem argumento), então o cliente só aproveitava
// activeRequests/recentRequests/errorProvider e jogava o resto fora. Os cards
// de visão geral, o gráfico e a tabela vinham só do SWR inicial — uma chamada
// feita pela API (o demo) aparecia na lista de recentes e em lugar nenhum
// mais até recarregar a página.

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const { useUsageStatsData } = await import("@/shared/components/useUsageStatsData");

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {}
}

function Probe({ period }: { period: string }) {
  const { stats } = useUsageStatsData(period);
  return <div data-testid="requests">{String((stats as { totalRequests?: number } | null)?.totalRequests ?? "")}</div>;
}

let totalRequests = 8;

function sse(recentRequests: Array<{ timestamp: string }>, total: number): string {
  return JSON.stringify({ activeRequests: [], recentRequests, errorProvider: "", totalRequests: total });
}

function statsFetches(): number {
  const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls.filter((args) => String(args[0]).startsWith("/api/usage/stats")).length;
}

beforeEach(() => {
  totalRequests = 8;
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/usage/stats")) {
      return new Response(JSON.stringify({ totalRequests, recentRequests: [] }));
    }
    if (url.startsWith("/api/providers")) return new Response(JSON.stringify({ connections: [] }));
    if (url.startsWith("/api/provider-nodes")) return new Response(JSON.stringify({ nodes: [] }));
    return new Response(JSON.stringify({}));
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useUsageStatsData", () => {
  it("re-reads the selected period's stats when the stream reports a write", async () => {
    const { getByTestId } = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Probe period="today" />
      </SWRConfig>,
    );

    await waitFor(() => expect(getByTestId("requests").textContent).toBe("8"));

    const stream = FakeEventSource.instances[0];
    expect(stream?.url).toBe("/api/usage/stream");

    // Primeira mensagem: o estado que o SWR de montagem já leu.
    stream.onmessage?.({ data: sse([{ timestamp: "2026-09-14T16:54:30.429Z" }], 999) });

    // Uma requisição nova chegou pela API. O payload do stream traz os totais
    // do período "all" — inúteis para a tela em "Hoje".
    totalRequests = 9;
    stream.onmessage?.({ data: sse([{ timestamp: "2026-09-14T16:59:02.000Z" }, { timestamp: "2026-09-14T16:54:30.429Z" }], 999) });

    await waitFor(() => expect(getByTestId("requests").textContent).toBe("9"));
  });

  it("ignores a stream wake-up that recorded nothing", async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Probe period="today" />
      </SWRConfig>,
    );

    await waitFor(() => expect(statsFetches()).toBe(1));
    const stream = FakeEventSource.instances[0];

    // Começo e fim de uma requisição: o stream acorda duas vezes com a mesma
    // linha no topo, e nenhum total mudou.
    stream.onmessage?.({ data: sse([{ timestamp: "2026-09-14T16:54:30.429Z" }], 8) });
    stream.onmessage?.({ data: sse([{ timestamp: "2026-09-14T16:54:30.429Z" }], 8) });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(statsFetches()).toBe(1);
  });
});
