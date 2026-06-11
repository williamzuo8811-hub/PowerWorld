// 主菜单 / 关卡选择界面（纯 DOM 覆盖层）：含多槽位存档列表、导入导出。
import type { Scenario } from '../game/scenarios';
import type { SaveMeta, SlotId } from '../game/save';
import { SLOT_LABEL } from '../game/save';

export interface MenuOptions {
  scenarios: Scenario[];
  saves: SaveMeta[]; // 已有存档（按时间倒序）
  bests?: Record<string, { grade: string; score: number }>; // 各关卡个人最佳（徽章）
  scenarioName: (id: string) => string;
  gameActive: boolean; // 当前是否有进行中的对局（可"另存到槽位"/"返回游戏"）
  onStart: (s: Scenario) => void;
  onLoad: (slot: SlotId) => void;
  onDelete: (slot: SlotId) => void;
  onExport: (slot: SlotId) => void;
  onImport: (json: string) => boolean;
  onSaveTo?: (slot: SlotId) => void; // 把当前对局存到指定槽位
  onResume?: () => void; // 返回当前对局
  // —— 自定义关卡（Mod）——
  customScenarios?: { name: string; brief: string; scenario: Scenario }[];
  onDeleteCustom?: (name: string) => void;
  onImportScenario?: (json: string) => string | null; // 返回错误信息或 null
  onExportCurrentScenario?: () => void; // 把当前局面导出为关卡文件
  // —— 元进度 / 变体模式 ——
  meta?: { level: number; frac: number; xp: number; wins: number; losses: number; rpBonusArmed: boolean };
  modes?: { id: string; name: string; icon: string; desc: string; locked: boolean; unlockLevel: number; selected: boolean }[];
  onSelectMode?: (id: string) => void;
}

export class Menu {
  private el = document.getElementById('menu')!;

  get isOpen(): boolean {
    return this.el.style.display === 'flex';
  }

  show(opts: MenuOptions): void {
    this.el.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    panel.innerHTML = `<h1>⚡ 电力世界</h1><p class="sub">硬核电网建造经营 · 发电 / 输电 / 变电 / 配电 — 选择关卡</p>`;

    if (opts.gameActive && opts.onResume) {
      const resume = document.createElement('button');
      resume.className = 'menu-continue';
      resume.textContent = '↩ 返回当前对局';
      resume.onclick = () => opts.onResume!();
      panel.appendChild(resume);
    }

    // —— 元进度：指挥官等级 + 经验条（通关/失败都涨经验，等级解锁变体玩法）——
    if (opts.meta) {
      const m = opts.meta;
      const bar = document.createElement('div');
      bar.className = 'menu-saves';
      bar.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:14px;font-weight:700">⭐ 指挥官 Lv.${m.level}</span>
          <span class="save-ts">通关 ${m.wins} · 失利 ${m.losses}${m.rpBonusArmed ? ' · <b style="color:var(--accent)">下局研发点 +10%（失利补偿）</b>' : ''}</span>
        </div>
        <div style="height:6px;background:#10161e;border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${Math.round(m.frac * 100)}%;background:var(--accent)"></div>
        </div>`;
      panel.appendChild(bar);
    }

    // —— 变体模式选择（按等级解锁）：选中后对任意战役关卡生效 ——
    if (opts.modes?.length) {
      const sec = document.createElement('div');
      sec.className = 'menu-saves';
      sec.innerHTML = `<div class="menu-sec-title">🎮 变体模式（叠加在所选关卡上 · 升级解锁更多）</div>`;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
      for (const md of opts.modes) {
        const b = document.createElement('button');
        b.className = 'save-mini';
        b.disabled = md.locked;
        b.title = md.locked ? `Lv.${md.unlockLevel} 解锁 · ${md.desc}` : md.desc;
        b.textContent = md.locked ? `🔒 ${md.icon} ${md.name}` : `${md.icon} ${md.name}`;
        if (md.selected) b.style.cssText += ';background:var(--accent);color:#04211a;font-weight:700';
        if (md.locked) b.style.opacity = '0.5';
        b.onclick = () => { if (!md.locked) opts.onSelectMode?.(md.id); };
        row.appendChild(b);
      }
      sec.appendChild(row);
      const selDesc = opts.modes.find((x) => x.selected)?.desc;
      if (selDesc) {
        const d = document.createElement('div');
        d.className = 'save-ts';
        d.textContent = selDesc;
        sec.appendChild(d);
      }
      panel.appendChild(sec);
    }

    // —— 存档区：列出所有槽位的存档（读档/导出/删除） ——
    if (opts.saves.length || opts.gameActive) {
      const sec = document.createElement('div');
      sec.className = 'menu-saves';
      sec.innerHTML = `<div class="menu-sec-title">💾 存档</div>`;
      for (const m of opts.saves) {
        const row = document.createElement('div');
        row.className = 'save-row';
        const when = new Date(m.ts);
        const timeStr = `${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
        const load = document.createElement('button');
        load.className = 'save-load';
        load.innerHTML = `▶ ${SLOT_LABEL[m.slot]} · ${opts.scenarioName(m.scenarioId)} · 第${m.day}天 <span class="save-ts">${timeStr}</span>`;
        load.onclick = () => opts.onLoad(m.slot);
        const exp = document.createElement('button');
        exp.className = 'save-mini';
        exp.title = '导出存档（下载 JSON 文件，可备份/分享）';
        exp.textContent = '⬇';
        exp.onclick = () => opts.onExport(m.slot);
        const del = document.createElement('button');
        del.className = 'save-mini';
        del.title = '删除此存档';
        del.textContent = '✕';
        del.onclick = () => {
          if (del.dataset.confirm === '1') opts.onDelete(m.slot);
          else { del.dataset.confirm = '1'; del.textContent = '确认?'; setTimeout(() => { del.dataset.confirm = ''; del.textContent = '✕'; }, 2000); }
        };
        row.appendChild(load);
        row.appendChild(exp);
        row.appendChild(del);
        sec.appendChild(row);
      }
      // 进行中的对局：可另存到手动槽位
      if (opts.gameActive && opts.onSaveTo) {
        const saveRow = document.createElement('div');
        saveRow.className = 'save-row';
        const lab = document.createElement('span');
        lab.className = 'save-ts';
        lab.style.alignSelf = 'center';
        lab.textContent = '把当前对局另存到：';
        saveRow.appendChild(lab);
        for (const slot of ['slot1', 'slot2', 'slot3'] as SlotId[]) {
          const b = document.createElement('button');
          b.className = 'save-mini';
          b.textContent = SLOT_LABEL[slot].replace('存档', '');
          b.onclick = () => opts.onSaveTo!(slot);
          saveRow.appendChild(b);
        }
        sec.appendChild(saveRow);
      }
      // 导入存档（文件选择）
      const impRow = document.createElement('div');
      impRow.className = 'save-row';
      const impBtn = document.createElement('button');
      impBtn.className = 'save-mini';
      impBtn.style.flex = '1';
      impBtn.textContent = '📂 导入存档文件（JSON）';
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.json,application/json';
      fileInput.style.display = 'none';
      fileInput.onchange = () => {
        const f = fileInput.files?.[0];
        if (!f) return;
        f.text().then((text) => {
          if (!opts.onImport(text)) {
            impBtn.textContent = '⚠ 导入失败：文件无效或版本不兼容';
            setTimeout(() => { impBtn.textContent = '📂 导入存档文件（JSON）'; }, 2500);
          }
        });
      };
      impBtn.onclick = () => fileInput.click();
      impRow.appendChild(impBtn);
      impRow.appendChild(fileInput);
      sec.appendChild(impRow);
      panel.appendChild(sec);
    }

    // —— 自定义关卡区（导入/导出/游玩/删除）——
    const customs = opts.customScenarios ?? [];
    if (customs.length || opts.onImportScenario || (opts.gameActive && opts.onExportCurrentScenario)) {
      const sec = document.createElement('div');
      sec.className = 'menu-saves';
      sec.innerHTML = `<div class="menu-sec-title">🛠 自定义关卡（搭好局面导出分享，对方导入即玩）</div>`;
      for (const c of customs) {
        const row = document.createElement('div');
        row.className = 'save-row';
        const play = document.createElement('button');
        play.className = 'save-load';
        play.innerHTML = `▶ ${c.name} <span class="save-ts">${c.brief}</span>`;
        play.onclick = () => opts.onStart(c.scenario);
        const del = document.createElement('button');
        del.className = 'save-mini';
        del.title = '删除此自定义关卡';
        del.textContent = '✕';
        del.onclick = () => {
          if (del.dataset.confirm === '1') opts.onDeleteCustom?.(c.name);
          else { del.dataset.confirm = '1'; del.textContent = '确认?'; setTimeout(() => { del.dataset.confirm = ''; del.textContent = '✕'; }, 2000); }
        };
        row.appendChild(play);
        row.appendChild(del);
        sec.appendChild(row);
      }
      const ctlRow = document.createElement('div');
      ctlRow.className = 'save-row';
      if (opts.onImportScenario) {
        const impBtn = document.createElement('button');
        impBtn.className = 'save-mini';
        impBtn.style.flex = '1';
        impBtn.textContent = '📂 导入关卡文件（JSON）';
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json,application/json';
        fileInput.style.display = 'none';
        fileInput.onchange = () => {
          const f = fileInput.files?.[0];
          if (!f) return;
          f.text().then((text) => {
            const err = opts.onImportScenario!(text);
            if (err) {
              impBtn.textContent = `⚠ ${err}`;
              setTimeout(() => { impBtn.textContent = '📂 导入关卡文件（JSON）'; }, 2500);
            }
          });
        };
        impBtn.onclick = () => fileInput.click();
        ctlRow.appendChild(impBtn);
        ctlRow.appendChild(fileInput);
      }
      if (opts.gameActive && opts.onExportCurrentScenario) {
        const expBtn = document.createElement('button');
        expBtn.className = 'save-mini';
        expBtn.style.flex = '1';
        expBtn.textContent = '⬇ 把当前局面导出为关卡';
        expBtn.onclick = () => opts.onExportCurrentScenario!();
        ctlRow.appendChild(expBtn);
      }
      if (ctlRow.children.length) sec.appendChild(ctlRow);
      panel.appendChild(sec);
    }

    const grid = document.createElement('div');
    grid.className = 'menu-grid';
    for (const s of opts.scenarios) {
      const card = document.createElement('button');
      card.className = 'menu-card';
      const goalsHtml = s.goals ? `<div class="mc-goals" style="margin-top:6px;font-size:11px;color:var(--accent)">🎯 ${s.goals}</div>` : '';
      const best = opts.bests?.[s.id];
      const bestHtml = best ? `<span style="float:right;font-weight:600;font-size:12px;color:var(--warn)">🏆 ${best.grade}·${best.score.toFixed(0)}</span>` : '';
      card.innerHTML = `<div class="mc-name">${s.name}${bestHtml}</div><div class="mc-brief">${s.brief}</div>${goalsHtml}`;
      card.onclick = () => opts.onStart(s);
      grid.appendChild(card);
    }
    panel.appendChild(grid);

    this.el.appendChild(panel);
    this.el.style.display = 'flex';
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
