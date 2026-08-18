import { describe, expect, it } from 'vitest';
import {
  FEISHU_BOT_MENU_COMMANDS,
  FEISHU_BOT_MENU_PARENT_I18N,
  buildFeishuBotMenuPayload,
} from '@electron/utils/feishu-auto-create';

describe('buildFeishuBotMenuPayload', () => {
  it('builds a single parent item grouping every quick command', () => {
    const payload = buildFeishuBotMenuPayload();
    const items = payload.bot_menu.bot_menu_items;

    expect(items).toHaveLength(1);
    const [parent] = items;
    expect(parent.name).toBe(FEISHU_BOT_MENU_PARENT_I18N.zh_cn);
    expect(parent.i18n_name).toEqual(FEISHU_BOT_MENU_PARENT_I18N);
    expect(parent.behaviors).toBeUndefined();
    expect(parent.children).toHaveLength(FEISHU_BOT_MENU_COMMANDS.length);
  });

  it('localizes the parent label across every Feishu-supported locale', () => {
    expect(Object.keys(FEISHU_BOT_MENU_PARENT_I18N).sort()).toEqual(['en_us', 'ja_jp', 'ru_ru', 'zh_cn']);
    Object.values(FEISHU_BOT_MENU_PARENT_I18N).forEach((label) => {
      expect(label.length).toBeGreaterThan(0);
    });
    // Labels come from channels.json (single source of truth), not hardcoded here.
    expect(FEISHU_BOT_MENU_PARENT_I18N.en_us).toBe('Quick Commands');
    expect(FEISHU_BOT_MENU_PARENT_I18N.zh_cn).toBe('快捷指令');
  });

  it("uses each command as the child item's name and send_message behavior", () => {
    const { children } = buildFeishuBotMenuPayload().bot_menu.bot_menu_items[0];

    children?.forEach((child, index) => {
      const command = FEISHU_BOT_MENU_COMMANDS[index];
      expect(child.name).toBe(command);
      // Commands are locale-invariant literals; i18n_name repeats the command per locale.
      expect(child.i18n_name).toEqual(
        Object.fromEntries(Object.keys(FEISHU_BOT_MENU_PARENT_I18N).map((locale) => [locale, command]))
      );
      expect(child.behaviors).toEqual([{ type: 'send_message', is_primary: true }]);
      expect(child.children).toBeUndefined();
    });
  });

  it('exposes the expected OpenClaw slash commands', () => {
    expect([...FEISHU_BOT_MENU_COMMANDS]).toEqual(['/new', '/stop', '/reset', '/status', '/compact']);
  });

  it('respects Feishu tier limits (<=5 top-level, <=30 children)', () => {
    const items = buildFeishuBotMenuPayload().bot_menu.bot_menu_items;
    expect(items.length).toBeLessThanOrEqual(5);
    expect(items[0].children?.length ?? 0).toBeLessThanOrEqual(30);
  });

  it('omits user_id for the global write and includes it for the per-user variant', () => {
    expect(buildFeishuBotMenuPayload()).not.toHaveProperty('user_id');
    expect(buildFeishuBotMenuPayload('ou_abc123').user_id).toBe('ou_abc123');
  });
});
