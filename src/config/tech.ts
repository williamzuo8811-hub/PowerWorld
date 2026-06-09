// 科技树定义与效果数值。研发点（RP）随持续供电的电量积累，用于解锁全局增益。
export type TechId = 'ehv' | 'efficient' | 'demandResponse' | 'bigTransformer' | 'advStorage' | 'autoReclose';

export interface TechSpec {
  id: TechId;
  name: string;
  desc: string;
  cost: number; // 研发点
}

export const TECHS: TechSpec[] = [
  { id: 'ehv', name: '超高压输电', desc: '高压线损降低 50%，远距离输电更划算。', cost: 55 },
  { id: 'efficient', name: '高效机组', desc: '可调机组燃料成本 −15%、碳排放 −20%。', cost: 50 },
  { id: 'demandResponse', name: '智能电网 / 需求响应', desc: '全网用电需求降低约 8%，削峰填谷。', cost: 70 },
  { id: 'bigTransformer', name: '大容量变压器', desc: '变电站变压器有效容量 +40%，更难过载。', cost: 45 },
  { id: 'advStorage', name: '先进储能', desc: '储能功率 +30%、往返效率提升。', cost: 75 },
  { id: 'autoReclose', name: '电网自愈 / 自动重合闸', desc: '跳闸线路在不再过载时自动恢复送电。', cost: 60 },
];

export const RP_PER_MWH = 0.02; // 每送达 1 MWh 积累的研发点

// 各科技的效果数值（集中可调）
export const TECH_FX = {
  hvLossFactor: 0.5, // 超高压：HV 线损系数 ×
  fuelCostFactor: 0.85, // 高效机组：燃料成本 ×
  co2Factor: 0.8, // 高效机组：碳排 ×
  demandFactor: 0.92, // 需求响应：需求 ×
  transformerRatingFactor: 1.4, // 大容量变压器：额定 ×
  batteryPowerFactor: 1.3, // 先进储能：功率 ×
  batteryRoundTripBonus: 0.05, // 先进储能：往返效率 +
  autoRecloseDelay: 25, // 自动重合闸延时（仿真秒）
};
