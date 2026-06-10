// 成就定义。每个成就有一个对当前游戏状态的判定函数；解锁后全局持久化。
import { TECHS } from './tech';

export interface AchvContext {
  peakServed: number; // 历史峰值供电 (MW)
  totalEnergyServed: number; // 累计送达电量 (MWh)
  renewableShare: number; // 清洁电力占比 0..1
  reputation: number; // 公众形象 0..100
  techCount: number; // 已解锁科技数
  allTech: boolean; // 是否点满科技
  won: boolean; // 是否达成关卡目标
  n1Secure: boolean; // 是否通过 N-1 校核
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  check: (c: AchvContext) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'firstPower', name: '初次送电', desc: '首次向用户送出电力。', check: (c) => c.totalEnergyServed > 0.1 },
  { id: 'grid100', name: '百兆电网', desc: '瞬时供电达到 100 MW。', check: (c) => c.peakServed >= 100 },
  { id: 'grid250', name: '区域骨干', desc: '瞬时供电达到 250 MW。', check: (c) => c.peakServed >= 250 },
  { id: 'green50', name: '绿色先锋', desc: '清洁电力占比达到 50%。', check: (c) => c.renewableShare >= 0.5 },
  { id: 'green90', name: '近零碳', desc: '清洁电力占比达到 90%。', check: (c) => c.renewableShare >= 0.9 },
  { id: 'beloved', name: '民心所向', desc: '公众形象达到 95。', check: (c) => c.reputation >= 95 },
  { id: 'researcher', name: '研发新锐', desc: '解锁 3 项科技。', check: (c) => c.techCount >= 3 },
  { id: 'allTech', name: '科技点满', desc: '解锁全部科技。', check: (c) => c.allTech },
  { id: 'n1', name: '坚强电网', desc: '通过一次 N-1 冗余校核。', check: (c) => c.n1Secure },
  { id: 'champion', name: '通关达人', desc: '达成任一关卡目标。', check: (c) => c.won },
];

export const ALL_TECH_COUNT = TECHS.length;
