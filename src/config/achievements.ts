// 成就定义。每个成就有一个对当前游戏状态的判定函数；解锁后全局持久化。
import { TECHS } from './tech';
import { SEASON_YEAR_DAYS } from './components';

export interface AchvContext {
  peakServed: number; // 历史峰值供电 (MW)
  totalEnergyServed: number; // 累计送达电量 (MWh)
  renewableShare: number; // 清洁电力占比 0..1
  reputation: number; // 公众形象 0..100
  techCount: number; // 已解锁科技数
  allTech: boolean; // 是否点满科技
  won: boolean; // 是否达成关卡目标
  n1Secure: boolean; // 是否通过 N-1 校核
  grade: string; // 当前综合星级 S/A/B/C/D
  outageEnergyTotal: number; // 累计失负荷电量 (MWh)
  netWorth: number; // 净资产
  debt: number; // 未偿贷款
  marketShare: number; // 区域市占 0..1
  day: number; // 游戏天数
  keyAccountKinds: number; // 已接入的大客户品类数（0..4）
}

export type AchvCategory = '里程碑' | '清洁转型' | '经营' | '挑战';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  category: AchvCategory;
  check: (c: AchvContext) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  // —— 里程碑 ——
  { id: 'firstPower', name: '初次送电', desc: '首次向用户送出电力。', category: '里程碑', check: (c) => c.totalEnergyServed > 0.1 },
  { id: 'grid100', name: '百兆电网', desc: '瞬时供电达到 100 MW。', category: '里程碑', check: (c) => c.peakServed >= 100 },
  { id: 'grid250', name: '区域骨干', desc: '瞬时供电达到 250 MW。', category: '里程碑', check: (c) => c.peakServed >= 250 },
  { id: 'champion', name: '通关达人', desc: '达成任一关卡目标。', category: '里程碑', check: (c) => c.won },
  { id: 'fullYear', name: '春夏秋冬', desc: '在一局中完整经历一年四季。', category: '里程碑', check: (c) => c.day >= SEASON_YEAR_DAYS },
  // —— 清洁转型 ——
  { id: 'green50', name: '绿色先锋', desc: '清洁电力占比达到 50%。', category: '清洁转型', check: (c) => c.renewableShare >= 0.5 },
  { id: 'green90', name: '近零碳', desc: '清洁电力占比达到 90%。', category: '清洁转型', check: (c) => c.renewableShare >= 0.9 },
  { id: 'cleanWin', name: '绿色通关', desc: '以 ≥80% 清洁占比达成关卡目标。', category: '清洁转型', check: (c) => c.won && c.renewableShare >= 0.8 },
  // —— 经营 ——
  { id: 'beloved', name: '民心所向', desc: '公众形象达到 95。', category: '经营', check: (c) => c.reputation >= 95 },
  { id: 'researcher', name: '研发新锐', desc: '解锁 3 项科技。', category: '经营', check: (c) => c.techCount >= 3 },
  { id: 'tycoon', name: '电力大亨', desc: '净资产达到 ¥3,000,000。', category: '经营', check: (c) => c.netWorth >= 3_000_000 },
  { id: 'marketKing', name: '市场霸主', desc: '区域市场份额达到 60%。', category: '经营', check: (c) => c.marketShare >= 0.6 },
  { id: 'fullHouse', name: '招商满堂彩', desc: '同时服务全部四类大客户（数据中心/交通/石化/矿业）。', category: '经营', check: (c) => c.keyAccountKinds >= 4 },
  // —— 挑战 ——
  { id: 'n1', name: '坚强电网', desc: '通过一次 N-1 冗余校核。', category: '挑战', check: (c) => c.n1Secure },
  { id: 'allTech', name: '科技点满', desc: '解锁全部科技。', category: '挑战', check: (c) => c.allTech },
  { id: 'sWin', name: 'S 级大师', desc: '以 S 级综合评级达成关卡目标。', category: '挑战', check: (c) => c.won && c.grade === 'S' },
  { id: 'zeroOutage', name: '零失负荷', desc: '通关且全程累计失负荷不足 1 MWh。', category: '挑战', check: (c) => c.won && c.outageEnergyTotal < 1 },
  { id: 'debtFreeWin', name: '无债一身轻', desc: '通关时无任何未偿贷款且净资产 ≥ ¥1,500,000。', category: '挑战', check: (c) => c.won && c.debt <= 0 && c.netWorth >= 1_500_000 },
];

export const ACHV_CATEGORIES: AchvCategory[] = ['里程碑', '清洁转型', '经营', '挑战'];
export const ALL_TECH_COUNT = TECHS.length;
