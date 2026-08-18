/**
 * Provider account `model` must be a plain string (model id or `provider/model` ref).
 * Multi-kind accounts send a positional `string[]` (one slot per modelType kind) —
 * persist it as a comma-joined string so positions survive the round-trip
 * (runtime sync re-splits on ','). OpenClaw agent config uses `{ primary: string }`
 * — that shape must never persist on accounts.
 */
export function normalizeProviderAccountModelField(model: unknown): string | undefined {
  if (typeof model === 'string') {
    const trimmed = model.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(model)) {
    // Keep empty slots — their position maps the model id to its kind.
    const joined = model
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .join(',');
    return /[^,]/.test(joined) ? joined : undefined;
  }
  if (model && typeof model === 'object') {
    const primary = (model as { primary?: unknown }).primary;
    if (typeof primary === 'string') {
      const trimmed = primary.trim();
      return trimmed || undefined;
    }
  }
  return undefined;
}
