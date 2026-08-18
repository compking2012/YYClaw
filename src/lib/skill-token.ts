/**
 * Skill-token parsing shared by the composer (ChatInput) and the send path
 * (chat store). The skill picker inserts a `/${skillName}  ` token (two trailing
 * spaces) into the composer; an explicit skill invocation is therefore just a
 * leading `/name` in the sent text.
 */

/**
 * Extract the skill name from a leading `/name` token, or null.
 *
 * Liberal on purpose — callers gate on whether the parsed name is a KNOWN
 * workflow skill, so a stray `/path` or `/date` that isn't a skill simply
 * resolves to no metadata and no card. Handles an optional `skill:` namespace
 * prefix (openclaw's `/skill:name` form) and the picker's trailing spaces.
 */
export function parseLeadingSkillToken(text: string): string | null {
  const match = text.match(/(?:^|\s)\/([A-Za-z0-9][A-Za-z0-9_:.-]*)(?=\s|$)/);
  if (!match) return null;
  let name = match[1] ?? '';
  const colon = name.indexOf(':');
  if (colon >= 0) name = name.slice(colon + 1); // /skill:name → name
  return name || null;
}
