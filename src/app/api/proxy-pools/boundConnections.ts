/**
 * How many connections are using a proxy pool.
 *
 * Deleting a pool that something points at is refused — as a 409 for one pool,
 * and as a `blocked` entry for a batch. Both routes read the rule from here so
 * a bulk delete cannot quietly become more permissive than a single one.
 */
export function countBoundConnections(
  connections: Record<string, unknown>[] = [],
  proxyPoolId: string,
): number {
  return connections.filter(
    (connection) => (connection?.providerSpecificData as Record<string, unknown>)?.proxyPoolId === proxyPoolId,
  ).length;
}
