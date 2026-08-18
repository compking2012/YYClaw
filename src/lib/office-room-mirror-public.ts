/**
 * Strip intermediate agent narration before posting to the team room.
 * Keeps deliverables, handoffs, and actionable @mentions — not 【理解】/「我的理解」 drafts.
 */

const BRACKET_HEADING_RE = /【\s*([^】]+)\s*】/g;

const INTERMEDIATE_SECTION_TITLES =
  /^(?:理解|判定|任务理解|复述|确认理解)$/u;

/** Smart JSON 镜像协议字段：仅供校验/引擎读取，不发群。 */
const SMART_PROTOCOL_MIRROR_SECTION_TITLES =
  /^(?:完成|结项|动作)$/u;

const ROOM_REPLY_SECTION_TITLES = /^(?:群聊回复|回复)$/u;

/** Section titles that may stay in the room (coordination / deliverable). */
const PUBLIC_SECTION_TITLES =
  /^(?:分工|交付|交接|协作询问|疑问|待确认|需要澄清|输出校验|交付产物|产物|用法说明|交接说明)$/u;

const SMART_PROTOCOL_MIRROR_TAIL_RE =
  /\n*【\s*(?:完成|结项)\s*】\s*(?:\n+\s*)?(?:true|false)\s*$/giu;

const SMART_PROTOCOL_ACTION_TAIL_RE =
  /\n*【\s*动作\s*】\s*(?:\n+\s*)?(?:assign|review|end|help)\s*$/giu;

const LEADING_INTERMEDIATE_RE = /^【(?:理解|判定|任务理解)】/u;

const MY_UNDERSTANDING_BLOCK_RE =
  /^#{1,4}\s*✅\s*我的理解\b[\s\S]*?(?=\n#{1,4}\s|\n---\n|\n【|$)/gimu;

const REPLY_BOILERPLATE_RE =
  /^##\s*💬[^\n]*\n+[\s\S]*?(?=\n#{1,4}\s*✅\s*(?!我的理解)|\n【(?:分工|交付)|\n---\n\n###\s*✅)/imu;

function splitBracketSections(text: string): Array<{ title: string; body: string }> {
  const matches = [...text.matchAll(BRACKET_HEADING_RE)];
  if (matches.length === 0) return [];

  const sections: Array<{ title: string; body: string }> = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const title = m[1]!.trim();
    const start = m.index! + m[0].length;
    const end = matches[i + 1]?.index ?? text.length;
    const body = text.slice(start, end).trim();
    sections.push({ title, body });
  }
  return sections;
}

function stripMyUnderstandingBlocks(text: string): string {
  return text.replace(MY_UNDERSTANDING_BLOCK_RE, '').trim();
}

function unwrapRoomReplyHeading(text: string): string {
  const m = text.trim().match(/^【\s*(?:群聊回复|回复)\s*】\s*([\s\S]*)$/u);
  return m?.[1]?.trim() ?? text.trim();
}

/** 去掉 Smart 协议镜像尾注（【完成】true、【动作】end 等）。保留协调者结项标记行「【结项】」。 */
export function stripSmartProtocolMirrorNoise(text: string): string {
  let out = text.trim();
  if (!out) return '';
  out = unwrapRoomReplyHeading(out);
  out = out.replace(SMART_PROTOCOL_MIRROR_TAIL_RE, '').trim();
  out = out.replace(SMART_PROTOCOL_ACTION_TAIL_RE, '').trim();
  return out;
}

function formatPublicMirrorSection(section: { title: string; body: string }): string {
  const title = section.title.trim();
  if (ROOM_REPLY_SECTION_TITLES.test(title)) return section.body.trim();
  return section.body ? `【${title}】\n${section.body}` : `【${title}】`;
}

function isNarrationOnlyUnstructured(body: string): boolean {
  const t = body.trim();
  if (!t) return true;
  if (/[@＠][\w\u4e00-\u9fa5]/u.test(t)) return false;
  if (/✅|已完成|交付|PRD|docs\/|\.(?:md|zip|pdf)/iu.test(t)) return false;
  return /^(?:用户在|关于用户|根据【团队|收到.*询问)/u.test(t) || t.length < 120;
}

function sliceFromFirstDeliverableMarker(text: string): string {
  const re =
    /(?:^|\n)(?:#{1,4}\s*)?✅\s*(?!我的理解)(?:交付|需求说明书|.*已完成)|(?:^|\n)###\s*✅\s*(?!我的理解)|(?:^|\n)【(?:分工|交付|交接)】/imu;
  const idx = text.search(re);
  if (idx <= 0) return text;
  return text.slice(idx).trim();
}

/** True when the body is only intermediate narration (should not be mirrored to the room). */
export function isIntermediateOnlyRoomMirrorText(raw: string): boolean {
  return !extractPublicRoomMirrorText(raw).trim();
}

/**
 * Public team-room body: drops 【理解】/【判定】/【任务理解】 and 「我的理解」 blocks;
 * keeps deliverable / handoff / clarification-with-action sections.
 */
export function extractPublicRoomMirrorText(raw: string): string {
  const text = raw.trim();
  if (!text) return '';

  const bracketMatches = [...text.matchAll(BRACKET_HEADING_RE)];
  if (
    bracketMatches.length === 1
    && INTERMEDIATE_SECTION_TITLES.test(bracketMatches[0]![1]!.trim())
  ) {
    const afterHeading = text
      .slice(bracketMatches[0]!.index! + bracketMatches[0]![0].length)
      .trim();
    if (afterHeading) return extractPublicRoomMirrorText(afterHeading);
    return '';
  }

  const sections = splitBracketSections(text);
  if (sections.length > 0) {
    const kept = sections
      .filter((s) => {
        const title = s.title.trim();
        if (INTERMEDIATE_SECTION_TITLES.test(title)) return false;
        if (SMART_PROTOCOL_MIRROR_SECTION_TITLES.test(title)) return false;
        if (PUBLIC_SECTION_TITLES.test(title)) return true;
        if (ROOM_REPLY_SECTION_TITLES.test(title)) return Boolean(s.body.trim());
        return !INTERMEDIATE_SECTION_TITLES.test(title);
      })
      .map((s) => formatPublicMirrorSection(s))
      .filter(Boolean)
      .join('\n\n')
      .trim();
    if (kept) {
      const stripped = stripSmartProtocolMirrorNoise(stripMyUnderstandingBlocks(kept));
      const preamble = coordinatorDispatchPreamble(text);
      if (preamble) return stripSmartProtocolMirrorNoise(`${preamble}\n\n${stripped}`.trim());
      return stripped;
    }
    return '';
  }

  let body = text.replace(REPLY_BOILERPLATE_RE, '').trim();
  body = stripMyUnderstandingBlocks(body);
  body = body.replace(/^【(?:理解|判定|任务理解)】[^\n]*\n?/gimu, '').trim();

  if (LEADING_INTERMEDIATE_RE.test(body)) {
    body = sliceFromFirstDeliverableMarker(body);
  } else if (/^【理解】/u.test(text)) {
    body = sliceFromFirstDeliverableMarker(body || text);
  }

  if (isNarrationOnlyUnstructured(body)) return '';
  return stripSmartProtocolMirrorNoise(body.trim());
}

/** Planning table / stage list before the first 【…】 section (Smart coordinator dispatch). */
function coordinatorDispatchPreamble(raw: string): string {
  const text = raw.trim();
  const firstBracket = text.search(/【/u);
  if (firstBracket <= 0) return '';
  const preamble = text.slice(0, firstBracket).trim();
  if (!preamble || preamble.length < 8) return '';
  if (!/[@＠]|任务拆解|项目阶段|阶段\s*[\t|]|执行者|M\d/i.test(preamble)) return '';
  return preamble.replace(REPLY_BOILERPLATE_RE, '').trim();
}

/** Coordinator task breakdown: keep stage table + actionable sections, still drop 【理解】 only. */
export function finalizeCoordinatorDispatchReply(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  const mirrored = extractPublicRoomMirrorText(text);
  if (mirrored.trim()) return stripSmartProtocolMirrorNoise(mirrored.trim());
  const preamble = coordinatorDispatchPreamble(text);
  if (preamble) return stripSmartProtocolMirrorNoise(preamble);
  return stripSmartProtocolMirrorNoise(
    text.replace(REPLY_BOILERPLATE_RE, '').replace(MY_UNDERSTANDING_BLOCK_RE, '').trim(),
  );
}

export function finalizeRoomMirrorReply(raw: string): string {
  return extractPublicRoomMirrorText(raw);
}
