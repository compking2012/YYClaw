import { hasWorkflowTaskUnderstandingHeading } from '@/lib/office-workflow-agent-structured';
import { isSmartJsonShapeText } from '@/lib/office-smart-json-schema';
import { listMissingSmartWorkflowMirrorSections } from '@/lib/office-workflow-output-sections';

/** 点名结构化正文完整度（越高越应作为校验用 raw）。 */
export function scoreSmartMentionStructuredCompleteness(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  let score = 0;
  if (isSmartJsonShapeText(s)) score += 35;
  if (hasWorkflowTaskUnderstandingHeading(s)) score += 10;
  if (/【\s*群聊回复\s*】/u.test(s)) score += 5;
  const missing = listMissingSmartWorkflowMirrorSections(s);
  if (missing.length === 0) score += 25;
  else score -= missing.length * 4;
  return score + Math.min(s.length / 300, 4);
}

/** 在 text / thinking / mirror 候选里选最完整、可校验的一条。 */
export function pickBestSmartMentionStructuredRaw(
  ...candidates: Array<string | null | undefined>
): string {
  let best = '';
  let bestScore = 0;
  for (const c of candidates) {
    const t = c?.trim() ?? '';
    if (!t) continue;
    const score = scoreSmartMentionStructuredCompleteness(t);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}
