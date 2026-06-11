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
  fit?: string; // 适配场景提示：什么关卡/局面下这项科技最值（研发面板悬停展示）
}

// 平衡说明（2026-06 重平衡）：拉开"必点"与"专精"的差距，让分支成为真正的路线选择——
//   普适性强的科技（hvdc/bigTransformer/demandResponse/autoReclose）加价；
//   情境性强的科技（dlr/flexCoal/vpp）增益做实（DLR 不再被 HVDC 碾压、灵活性改造省启停费、VPP 提供可信容量）。
export const TECHS: TechSpec[] = [
  // —— 输电 ——
  { id: 'ehv', name: '超高压输电', desc: '高压线损降低 50%，远距离输电更划算。', cost: 55, branch: '输电', fit: '远郊矿区/大跨度地图：长线远供的线损立省一半' },
  { id: 'hvdc', name: '特高压直流', desc: '高压线损再降 30%、高压线路热极限 +25%。', cost: 130, branch: '输电', requires: ['ehv'], fit: '超大电网终局：仅强化 HV 干线，配电瓶颈需配 DLR/变压器' },
  { id: 'dlr', name: '动态增容(DLR)', desc: '实时测温放开静态限额：全部线路（含中压配电）热极限 +22%。', cost: 70, branch: '输电', requires: ['ehv'], fit: '配电网过载/风暴季：HVDC 管不到的 MV 配电线只有它能扩' },
  { id: 'bigTransformer', name: '大容量变压器', desc: '变电站变压器有效容量 +40%，更难过载。', cost: 60, branch: '输电', fit: '单变电站枢纽布局：变压器是第一个被城市增长压垮的瓶颈' },
  // —— 发电 ——
  { id: 'efficient', name: '高效机组', desc: '可调机组燃料成本 −15%、碳排放 −20%。', cost: 50, branch: '发电', fit: '火电主力的前中期：燃料账单越大省得越多' },
  { id: 'combinedCycle', name: '燃气联合循环', desc: '燃气机组边际成本再降 20%（更高热效率）。', cost: 90, branch: '发电', requires: ['efficient'], fit: '燃气调峰路线/迎峰度夏：尖峰时段的度电成本直降' },
  { id: 'flexCoal', name: '火电灵活性改造', desc: '燃煤最小出力 −50%、爬坡率 +50%、启停成本 −50%——老火电变身调峰帮手。', cost: 75, branch: '发电', requires: ['efficient'], fit: '存量燃煤+高新能源：让旧煤机顶替昂贵燃气做调峰' },
  { id: 'ccsAdv', name: '新一代碳捕集', desc: 'CCS 能耗惩罚 1.4→1.2、捕集率 90%→95%。', cost: 100, branch: '发电', requires: ['efficient'], fit: '碳中和转型关/碳价高企：保留火电同时大幅脱碳' },
  // —— 储能 ——
  { id: 'advStorage', name: '先进储能', desc: '储能功率 +30%、往返效率提升。', cost: 75, branch: '储能', fit: '风光占比高的电网：同样的电池顶更多尖峰' },
  { id: 'gridForming', name: '构网型储能', desc: '储能逆变器无功能力 +50%、容量信用 +20%（支撑电压与充裕度）。', cost: 95, branch: '储能', requires: ['advStorage'], fit: '长线欠压/容量市场收益流：储能兼职"电压支撑+可信容量"' },
  { id: 'longDuration', name: '长时储能优化', desc: '全部储能能量容量 +25%（跨更多小时套利/顶峰）。', cost: 110, branch: '储能', requires: ['advStorage'], fit: '多日无风阴雨/冬季枯水：靠储得久扛过新能源连枯' },
  // —— 智能电网 ——
  { id: 'demandResponse', name: '智能电网 / 需求响应', desc: '全网用电需求降低约 6%，削峰填谷。', cost: 80, branch: '智能电网', fit: '任何高峰压力局面：等效于免费多 6% 装机' },
  { id: 'forecasting', name: '功率预测 AI', desc: '新能源预测误差减半：运行备用需求增幅 −50%、新能源有效出力 +5%、出力波动噪声减半。', cost: 90, branch: '智能电网', requires: ['demandResponse'], fit: '高比例风光：备用费省一半，出力曲线更平稳' },
  { id: 'vpp', name: '虚拟电厂(VPP)', desc: '需求响应可削减量 +50%、激励成本 −30%，且可削减负荷计入可信容量（吃容量补偿）。', cost: 100, branch: '智能电网', requires: ['demandResponse'], fit: '容量市场紧张/不想再建调峰电厂：把用户侧变成你的电厂' },
  { id: 'autoReclose', name: '电网自愈 / 自动重合闸', desc: '跳闸线路在不再过载时自动恢复送电。', cost: 75, branch: '智能电网', fit: '风暴季/无人值守挂机：免去手动重合闸的微操' },
  { id: 'selfHealing', name: '自愈电网 2.0', desc: '重合闸延时 25s→10s，线路/变压器耐受过载时间 +30%。', cost: 100, branch: '智能电网', requires: ['autoReclose'], fit: '连锁跳闸风险高的重载电网：给保护装置加"耐心"' },
  // —— 市场经营 ——
  { id: 'trading', name: '电力交易室', desc: '套保手续费 −40%、期权权利金 −30%（更便宜的风险管理）。', cost: 65, branch: '市场经营', fit: '现货波动大/燃料冲击频繁：锁价成本立省四成' },
  { id: 'riskMgmt', name: '风险管理体系', desc: '保险费率 −40%、贷款日利率 −0.1%。', cost: 95, branch: '市场经营', requires: ['trading'], fit: '高杠杆扩张期：利息与保费的双重折扣' },
  { id: 'lobby', name: '政策研究中心', desc: '绿证价 +20%、免费碳配额基准 +10%（更懂政策红利）。', cost: 130, branch: '市场经营', requires: ['trading'], fit: '清洁路线终局：绿证+配额双补贴拉满' },
];

export const TECH_BRANCHES: TechBranch[] = ['输电', '发电', '储能', '智能电网', '市场经营'];

export const RP_PER_MWH = 0.02; // 每送达 1 MWh 积累的研发点

// 各科技的效果数值（集中可调）
export const TECH_FX = {
  hvLossFactor: 0.5, // 超高压：HV 线损系数 ×
  hvdcLossFactor: 0.7, // 特高压直流：HV 线损再 ×
  hvdcCapacityFactor: 1.25, // 特高压直流：HV 热极限 ×
  dlrCapacityFactor: 1.22, // 动态增容：全部线路热极限 ×（覆盖 MV 配电——HVDC 管不到的地方）
  fuelCostFactor: 0.85, // 高效机组：燃料成本 ×
  co2Factor: 0.8, // 高效机组：碳排 ×
  gasCostFactor: 0.8, // 联合循环：燃气边际成本 ×
  coalPminFactor: 0.5, // 火电灵活性：燃煤 pmin ×
  coalRampFactor: 1.5, // 火电灵活性：燃煤爬坡 ×
  coalStartupFactor: 0.5, // 火电灵活性：燃煤启停成本 ×（频繁调峰启停不再肉疼）
  ccsAdvCostFactor: 1.2, // 新一代 CCS：能耗惩罚（替代 1.4）
  ccsAdvCaptureRate: 0.95, // 新一代 CCS：捕集率（替代 0.9）
  demandFactor: 0.94, // 需求响应：需求 ×（普适增益收窄，避免"无脑必点"）
  forecastReserveK: 0.5, // 功率预测：新能源备用需求放大系数 ×
  forecastRenewFactor: 1.05, // 功率预测：新能源有效出力 ×
  forecastNoiseFactor: 0.5, // 功率预测：新能源分钟级出力噪声幅度 ×（预测准 → 波动小）
  vppDrFractionFactor: 1.5, // VPP：可削减比例 ×
  vppDrIncentiveFactor: 0.7, // VPP：激励成本 ×
  vppFirmCredit: 0.6, // VPP：可削减负荷计入可信容量的比例（容量补偿的新收益流）
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
