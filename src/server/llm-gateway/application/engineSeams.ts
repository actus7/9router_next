import { installErrorJudge } from "./errorJudge";
import { installFusionJudge } from "./fusionJudge";
import { installModelStatsStore } from "./modelStatsStore";

// The engine's seams (measurements store, error judge, fusion judge) are
// installed here, from the request path itself — gatewayRoute and the durable
// run worker — and not only from instrumentation.ts. In the Docker build the
// seams the bootstrap installed were not the ones the route handlers saw:
// modelPerf stayed empty across real traffic (gatewayDockerLive found it).
// Installing where the request runs does not depend on how Next splits the
// bootstrap from the routes. Idempotent and cheap: three assignments, once
// per module instance.
let installed = false;

export function ensureEngineSeams(): void {
  if (installed) return;
  installed = true;
  installModelStatsStore();
  installErrorJudge();
  installFusionJudge();
}

/** Test hook: lets a test clear the seams and see them installed again. */
export function resetEngineSeamsForTests(): void {
  installed = false;
}
