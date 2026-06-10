import { describe, it, expect, beforeEach } from 'vitest';
import { STRINGS, type StringKey } from './strings';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe('i18n 字符串表', () => {
  it('英文表覆盖全部中文键（无遗漏键）', () => {
    const zhKeys = Object.keys(STRINGS.zh) as StringKey[];
    for (const k of zhKeys) {
      expect(STRINGS.en[k], `en 缺少键 ${k}`).toBeTruthy();
    }
    expect(Object.keys(STRINGS.en).length).toBe(zhKeys.length);
  });

  it('t() 按 locale 取词并在缺失时回退中文', async () => {
    const { t, setLocale, getLocale } = await import('./index');
    setLocale('zh');
    expect(t('stat_money')).toBe('资金');
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(t('stat_money')).toBe('Cash');
    expect(t('grp_grid')).toBe('Grid');
  });

  it('locale 持久化', async () => {
    const { setLocale } = await import('./index');
    setLocale('en');
    expect(store.get('powerworld.locale')).toBe('en');
    setLocale('zh');
    expect(store.get('powerworld.locale')).toBe('zh');
  });
});
