/** Estimated task duration in whole minutes, or null when missing or invalid. */
export function normalizeEstimate(value: unknown): number | null {
  const minutes = typeof value === "string" ? Number(value) : value;
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) return null;
  const rounded = Math.round(minutes);
  return rounded >= 1 && rounded <= 10000 ? rounded : null;
}

export function formatEstimate(minutes: number | null | undefined): string | null {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? (rest ? `${hours} h ${rest}` : `${hours} h`) : `${rest} min`;
}
