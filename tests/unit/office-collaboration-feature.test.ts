import { describe, expect, it } from 'vitest';
import {
  isOfficeCollaborationEnabled,
  SHOW_OFFICE_COLLABORATION,
} from '@shared/office-collaboration-feature';

describe('office collaboration compile-time feature', () => {
  it('exports a consistent enabled flag', () => {
    expect(isOfficeCollaborationEnabled()).toBe(SHOW_OFFICE_COLLABORATION);
  });
});
