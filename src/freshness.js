export function eventFreshness(lastEventAt, now = Date.now()) {
  const timestamp = Date.parse(lastEventAt);
  if (!Number.isFinite(timestamp)) return { label: "No events yet", tone: "unknown", ageMs: null };
  const ageMs = Math.max(0, now - timestamp);
  if (ageMs < 15_000) return { label: "Updated just now", tone: "fresh", ageMs };
  if (ageMs < 60_000) return { label: `Updated ${Math.floor(ageMs / 1000)}s ago`, tone: "fresh", ageMs };
  if (ageMs < 5 * 60_000) return { label: `Updated ${Math.floor(ageMs / 60_000)}m ago`, tone: "recent", ageMs };
  return { label: `Quiet for ${Math.floor(ageMs / 60_000)}m`, tone: "quiet", ageMs };
}
