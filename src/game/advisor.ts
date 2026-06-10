// 顾问提示系统：事件驱动的情境教学。监测仿真状态，在玩家"需要某个系统"的时刻
// 提示对应工具/面板——把 40+ 个子系统的学习成本摊到对局过程中。每条提示每局只发一次。
import type { Simulation } from '../sim/simulation';
import { TECHS } from '../config/tech';
import { KEY_ACCOUNTS } from '../config/components';

export interface AdvisorRule {
  id: string;
  when: (sim: Simulation) => boolean;
  text: string;
}

export const ADVISOR_RULES: AdvisorRule[] = [
  {
    id: 'lowCash',
    when: (s) => !s.sandbox && s.money < 60_000 && s.creditLimit - s.debt > 100_000,
    text: '💡 顾问：现金吃紧——打开 📊 财务面板贷款，可摊平建设工期的现金流压力（注意利率与杠杆）。',
  },
  {
    id: 'noStorage',
    when: (s) => s.day >= 2 && s.grid.batteries.size === 0
      && [...s.grid.gens.values()].filter((g) => !g.dispatchable).length >= 2,
    text: '💡 顾问：风/光靠天吃饭——配套储能可消纳过剩、顶峰放电，还能赚价差套利与辅助服务收入。',
  },
  {
    id: 'techAffordable',
    when: (s) => {
      const cheapest = Math.min(...TECHS.filter((t) => !s.tech.unlocked.has(t.id) && s.tech.canUnlock(t.id)).map((t) => t.cost));
      return Number.isFinite(cheapest) && s.tech.points >= cheapest + 15;
    },
    text: '💡 顾问：研发点已够解锁科技——点顶栏 🔬 打开科技树，五条分支各有专精方向。',
  },
  {
    id: 'satLow',
    when: (s) => s.customerSatisfaction < 0.7
      && [...s.grid.loads.values()].some((l) => KEY_ACCOUNTS[l.profile]),
    text: '💡 顾问：大客户满意度走低，再不保供会被对手挖走——补电源、加 🔋 自备应急电源、或签 📜 长约锁忠诚。',
  },
  {
    id: 'peakSeason',
    when: (s) => (s.seasonLabel === '夏' || s.seasonLabel === '冬') && s.grid.loads.size > 0,
    text: '💡 顾问：旺季已至——打开 🧭 IRP 压力测试校核可信容量是否扛得住季节峰，缺口要提前开工补强。',
  },
  {
    id: 'n1Never',
    when: (s) => s.day >= 3 && !s.n1Secure && s.grid.lines.size >= 3,
    text: '💡 顾问：电网长大了——点顶栏 N-1 做冗余校核，找出"单点故障会引发停电"的薄弱环节。',
  },
  {
    id: 'outageNoInsurance',
    when: (s) => !s.insured && [...s.grid.gens.values()].some((g) => g.outageUntil != null),
    text: '💡 顾问：机组强迫停运很伤——📊 财务面板可投设备保险，赔付 80% 检修与风暴损失。',
  },
  {
    id: 'unreliableNoMarket',
    when: (s) => !s.marketEnabled && !s.sandbox && s.reliability < s.goalReliability && s.day >= 1,
    text: '💡 顾问：可靠性低于目标——接入批发市场（📊 面板）可购电兜底缺口，代价是市价加价与日费。',
  },
  {
    id: 'highCarbon',
    when: (s) => {
      const snap = s.snapshot();
      return snap.totalServed > 1 && snap.co2 / Math.max(snap.totalServed, 1) > s.benchmarkIntensity * 1.3;
    },
    text: '💡 顾问：排放强度远超免费配额基准，碳费在吞噬利润——上清洁电源、给火电加 🌫 CCS、或多用低碳机组。',
  },
  {
    id: 'leadActive',
    when: (s) => s.keyAccountLead != null,
    text: '💡 顾问：出现限时招商机会（🗂 品类面板可见）——窗口期内接入该大客户享接入费折扣，过期可能被对手抢走。',
  },
];

export class Advisor {
  private fired = new Set<string>();
  private nextCheckAt = 0; // 下次检查的仿真小时（节流）

  reset(): void {
    this.fired.clear();
    this.nextCheckAt = 0;
  }

  /** 每帧调用：至多返回一条新提示（每条每局只发一次；每 0.5 游戏小时检查一次） */
  update(sim: Simulation): string | null {
    if (sim.clock < this.nextCheckAt || sim.gameOver) return null;
    this.nextCheckAt = sim.clock + 0.5;
    for (const r of ADVISOR_RULES) {
      if (this.fired.has(r.id)) continue;
      let hit = false;
      try {
        hit = r.when(sim);
      } catch {
        /* 规则计算异常时跳过该规则 */
      }
      if (hit) {
        this.fired.add(r.id);
        return r.text;
      }
    }
    return null;
  }
}
