// i18n 基建：字符串表 + locale 持久化。
// 第一阶段抽离"界面框架"（顶栏/工具栏/菜单/设置/遮罩）；仿真日志与剧情文案按此模式逐步迁移。
import { STRINGS, type StringKey } from './strings';

export type Locale = 'zh' | 'en';
const KEY = 'powerworld.locale';

let locale: Locale = 'zh';
try {
  const saved = localStorage.getItem(KEY);
  if (saved === 'en' || saved === 'zh') locale = saved;
} catch {
  /* 忽略 */
}

export function getLocale(): Locale {
  return locale;
}

export function setLocale(l: Locale): void {
  locale = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* 忽略 */
  }
}

/** 取当前语言的字符串；缺失时回退中文 */
export function t(key: StringKey): string {
  return STRINGS[locale][key] ?? STRINGS.zh[key] ?? key;
}
