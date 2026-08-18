import { buildSmartMentionFormatRetryHeader } from '../../../../../src/lib/office-smart-retry-prompt';

/** @deprecated 使用 buildSmartMentionFormatRetryHeader；保留兼容 re-export。 */
export function buildSmartCoordinatorRetryPreamble(params: {
  roleName: string;
  reasonDetail: string;
  priorRaw: string;
  issues?: string[];
}): string {
  return buildSmartMentionFormatRetryHeader(params);
}
