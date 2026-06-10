// 科技树定义与效果数值。研发点（RP）随持续供电的电量积累，用于解锁全局增益。
// 五条分支（输电/发电/储能/智能电网/市场经营），高阶科技有前置依赖——形成"专精方向"的研发决策。
export type TechId =
  // 输电
  | 'ehv' | 'hvdc' | 'dlr' | 'bigTransformer'
  // 发电
  | 'efficient' | 'combinedCycle' | 'flexCoal' | 'ccsAdv'
  // 储能
  | 'advStorage' | 'gridForming' | 'longDuration'
  // 智能电网
  | 'demandResponse' | 'forecasting' | 'vpp' | 'autoReclose' | 'selfHealing'
  // 市场经营
  | 'trading' | 'riskMgmt' | 'lobby';

export type TechBranch = '输电' | '发电' | '储能' | '智能电网' | '市场经营';

export interface TechSpec {
  id: TechId;
  name: string;
  desc: string;
  cost: number; // 研发点
  branch: TechBranch;
  requires?: TechId[]; // 前置科技（全部满足才可研发）
}

export const TECHS: TechSpec[] = [
  // —— 输电 ——
  { id: 'ehv', name: '超高压输电', desc: '高压线损降低 50%，远距离输电更划算。', cost: 55, branch: '输电' },
  { id: 'hvdc', name: '特高压直流', desc: '高压线损再降 30%、高压线路热极限 +25%。', cost: 110, branch: '输电', requires: ['ehv'] },
  { id: 'dlr', name: '动态增容(DLR)', desc: '实时测温放开静态限额：全部线路热极限 +15%。', cost: 80, branch: '输电', requires: ['ehv'] },
  { id: 'bigTransformer', name: '大容量变压器', desc: '变电站变压器有效容量 +40%，更难过载。', cost: 45, branch: '输电' },
  // —— 发电 ——
  { id: 'efficient', name: '高效机组', desc: '可调机组燃料成本 −15%、碳排放 −20%。', cost: 50, branch: '发电' },
  { id: 'combinedCycle', name: '燃气联合循环', desc: '燃气机组边际成本再降 20%（更高热效率）。', cost: 90, branch: '发电', requires: ['efficient'] },
  { id: 'flexCoal', name: '火电灵活性改造', desc: '燃煤最小出力 −50%、爬坡率 +50%——老火电变身调峰帮手。', cost: 85, branch: '发电', requires: ['efficient'] },
  { id: 'ccsAdv', name: '新一代碳捕集', desc: 'CCS 能耗惩罚 1.4→1.2、捕集率 90%→95%。', cost: 100, branch: '发电', requires: ['efficient'] },
  // —— 储能 ——
  { id: 'advStorage', name: '先进储能', desc: '储能功率 +30%、往返效率提升。', cost: 75, branch: '储能' },
  { id: 'gridForming', name: '构网型储能', desc: '储能逆变器无功能力 +50%、容量信用 +20%（支撑电压与充裕度）。', cost: 95, branch: '储能', requires: ['advStorage'] },
  { id: 'longDuration', name: '长时储能优化', desc: '全部储能能量容量 +25%（跨更多小时套利/顶峰）。', cost: 110, branch: '储能', requires: ['advStorage'] },
  // —— 智能电网 ——
  { id: 'demandResponse', name: '智能电网 / 需求响应', desc: '全网用电需求降低约 8%，削峰填谷。', cost: 70, branch: '智能电网' },
  { id: 'forecasting', name: '功率预测 AI', desc: '新能源预测误差减半：运行备用需求增幅 −50%、新能源有效出力 +5%。', cost: 90, branch: '智能电网', requires: ['demandResponse'] },
  { id: 'vpp', name: '虚拟电厂(VPP)', desc: '需求响应可削减量 +50%、激励成本 −30%。', cost: 120, branch: '智能电网', requires: ['demandResponse'] },
  { id: 'autoReclose', name: '电网自愈 / 自动重合闸', desc: '跳闸线路在不再过载时自动恢复送电。', cost: 60, branch: '智能电网' },
  { id: 'selfHealing', name: '自愈电网 2.0', desc: '重合闸延时 25s→10s，线路/变压器耐受过载时间 +30%。', cost: 100, branch: '智能电网', requires: ['autoReclose'] },
  // —— 市场经营 ——
  { id: 'trading', name: '电力交易室', desc: '套保手续费 −40%、期权权利金 −30%（更便宜的风险管理）。', cost: 65, branch: '市场经营' },
  { id: 'riskMgmt', name: '风险管理体系', desc: '保险费率 −40%、贷款日利率 −0.1%。', cost: 95, branch: '市场经营', requires: ['trading'] },
  { id: 'lobby', name: '政策研究中心', desc: '绿证价 +20%、免费碳配额基准 +10%（更懂政策红利）。', cost: 130, branch: '市场经营', requires: ['trading'] },
];

export const TECH_BRANCHES: TechBranch[] = ['输电', '发电', '储能', '智能电网', '市场经营'];

export const RP_PER_MWH = 0.02; // 每送达 1 MWh 积累的研发点

// 各科技的效果数值（集中可调）
export const TECH_FX = {
  hvLossFactor: 0.5, // 超高压：HV 线损系数 ×
  hvdcLossFactor: 0.7, // 特高压直流：HV 线损再 ×
  hvdcCapacityFactor: 1.25, // 特高压直流：HV 热极限 ×
  dlrCapacityFactor: 1.15, // 动态增容：全部线路热极限 ×
  fuelCostFactor: 0.85, // 高效机组：燃料成本 ×
  co2Factor: 0.8, // 高效机组：碳排 ×
  gasCostFactor: 0.8, // 联合循环：燃气边际成本 ×
  coalPminFactor: 0.5, // 火电灵活性：燃煤 pmin ×
  coalRampFactor: 1.5, // 火电灵活性：燃煤爬坡 ×
  ccsAdvCostFactor: 1.2, // 新一代 CCS：能耗惩罚（替代 1.4）
  ccsAdvCaptureRate: 0.95, // 新一代 CCS：捕集率（替代 0.9）
  demandFactor: 0.92, // 需求响应：需求 ×
  forecastReserveK: 0.5, // 功率预测：新能源备用需求放大系数 ×
  forecastRenewFactor: 1.05, // 功率预测：新能源有效出力 ×
  vppDrFractionFactor: 1.5, // VPP：可削减比例 ×
  vppDrIncentiveFactor: 0.7, // VPP：激励成本 ×
  transformerRatingFactor: 1.4, // 大容量变压器：额定 ×
  batteryPowerFactor: 1.3, // 先进储能：功率 ×
  batteryRoundTripBonus: 0.05, // 先进储能：往返效率 +
  storageQFactor: 1.5, // 构网型储能：储能无功能力 ×
  storageCreditFactor: 1.2, // 构网型储能：储能容量信用 ×
  storageEnergyFactor: 1.25, // 长时储能：能量容量 ×
  autoRecloseDelay: 25, // 自动重合闸延时（仿真秒）
  selfHealRecloseDelay: 10, // 自愈 2.0：重合闸延时（仿真秒）
  selfHealTripFactor: 1.3, // 自愈 2.0：过载耐受时间 ×
  hedgeFeeFactor: 0.6, // 交易室：套保手续费 ×
  optionPremiumFactor: 0.7, // 交易室：期权权利金 ×
  insuranceFactor: 0.6, // 风险管理：保险费率 ×
  loanRateDiscount: 0.001, // 风险管理：贷款日利率 −
  recFactor: 1.2, // 政策研究：绿证价 ×
  benchmarkFactor: 1.1, // 政策研究：免费配额基准 ×
};
