/** How many proposals one image edit draws, and each one's direction when there is one for every proposal (the server plans 1 to 4). */
export function candidatePlan(config: { candidateCount?: number; candidateDirections?: readonly string[] }): { count?: number; variations?: string[] } {
  const count = config.candidateCount && config.candidateCount > 1 ? Math.min(4, Math.floor(config.candidateCount)) : 0;
  if (!count) return {};
  const directions = (config.candidateDirections ?? []).slice(0, count).map((item) => item.trim());
  return directions.length === count && directions.every(Boolean) ? { count, variations: directions } : { count };
}
