export interface OfficeChannelBinding {
  channelType: string;
  accountId: string;
}

export function channelBindingKey(binding: OfficeChannelBinding): string {
  return `${binding.channelType}:${binding.accountId}`;
}

export function normalizeChannelBindings(bindings: OfficeChannelBinding[]): OfficeChannelBinding[] {
  const seen = new Set<string>();
  const out: OfficeChannelBinding[] = [];
  for (const b of bindings) {
    const channelType = b.channelType?.trim();
    const accountId = b.accountId?.trim();
    if (!channelType || !accountId) continue;
    const key = `${channelType}:${accountId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ channelType, accountId });
  }
  return out;
}

export function bindingsFromChannelAccountOwners(
  agentId: string,
  channelAccountOwners: Record<string, string>,
): OfficeChannelBinding[] {
  const bindings: OfficeChannelBinding[] = [];
  for (const [key, owner] of Object.entries(channelAccountOwners)) {
    if (owner !== agentId) continue;
    const sep = key.indexOf(':');
    if (sep <= 0) continue;
    bindings.push({
      channelType: key.slice(0, sep),
      accountId: key.slice(sep + 1),
    });
  }
  return normalizeChannelBindings(bindings);
}

export function bindingsEqual(a: OfficeChannelBinding[], b: OfficeChannelBinding[]): boolean {
  const na = normalizeChannelBindings(a);
  const nb = normalizeChannelBindings(b);
  if (na.length !== nb.length) return false;
  const keysA = new Set(na.map(channelBindingKey));
  return nb.every((x) => keysA.has(channelBindingKey(x)));
}
