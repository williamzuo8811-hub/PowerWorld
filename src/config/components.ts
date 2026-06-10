// 组件目录与全局经济/物理常量。所有可调平衡数值集中在这里，方便调参。
import type { PlantType, VoltageClass, LoadProfile } from '../sim/types';

export interface PlantSpec {
  type: PlantType;
  label: string;
  capacity: number; // MW
  pmin: number; // MW
  rampRate: number; // MW / 仿真秒（火电慢、燃气快、核电极慢、新能源不限）
  marginalCost: number; // $/MWh
  capex: number; // 一次性建造成本 $
  buildDays: number; // 建设工期（天）—— 期间已付钱但不发电
  omPerDay: number; // 固定运维成本 ($/天，仅投运后计)
  cf: number; // 代表性容量系数（0..1），用于投资回报估算
  dispatchable: boolean;
  co2: number; // 吨 / MWh
  startupCost: number; // 冷启动成本 ¥（每次离线→并网）
  minUpHours: number; // 最小开机时间（小时）
  minDownHours: number; // 最小停机时间（小时）
  color: number; // 渲染颜色
  desc: string;
}

// 数值刻意区分出"基荷/调峰/间歇"三类角色，并加入工期/运维，构成"投资 vs 收益"权衡。
export const PLANTS: Record<PlantType, PlantSpec> = {
  nuclear: {
    type: 'nuclear', label: '核电', capacity: 120, pmin: 80, rampRate: 0.08,
    marginalCost: 10, capex: 820_000, buildDays: 8, omPerDay: 1_200, cf: 0.9, dispatchable: true, co2: 0,
    startupCost: 50_000, minUpHours: 24, minDownHours: 18,
    color: 0xa78bfa, desc: '巨大基荷·投资高·工期最长·几乎不可调',
  },
  coal: {
    type: 'coal', label: '燃煤', capacity: 60, pmin: 18, rampRate: 0.35,
    marginalCost: 26, capex: 230_000, buildDays: 4, omPerDay: 600, cf: 0.6, dispatchable: true, co2: 0.95,
    startupCost: 12_000, minUpHours: 6, minDownHours: 4,
    color: 0x9aa4ad, desc: '便宜基荷·爬坡慢·高排放·启停成本高',
  },
  gas: {
    type: 'gas', label: '燃气', capacity: 40, pmin: 0, rampRate: 2.2,
    marginalCost: 58, capex: 110_000, buildDays: 1.5, omPerDay: 250, cf: 0.25, dispatchable: true, co2: 0.45,
    startupCost: 700, minUpHours: 0.5, minDownHours: 0.5,
    color: 0xf2994a, desc: '工期短·灵活调峰·爬坡快·启停廉价·燃料贵',
  },
  wind: {
    type: 'wind', label: '风电', capacity: 30, pmin: 0, rampRate: 999,
    marginalCost: 0, capex: 150_000, buildDays: 3, omPerDay: 200, cf: 0.35, dispatchable: false, co2: 0,
    startupCost: 0, minUpHours: 0, minDownHours: 0,
    color: 0x56ccf2, desc: '零燃料·工期较长·看风·夜间也可发',
  },
  solar: {
    type: 'solar', label: '光伏', capacity: 30, pmin: 0, rampRate: 999,
    marginalCost: 0, capex: 125_000, buildDays: 2, omPerDay: 150, cf: 0.2, dispatchable: false, co2: 0,
    startupCost: 0, minUpHours: 0, minDownHours: 0,
    color: 0xf2c94c, desc: '零燃料·工期中等·只在白天·午间最强',
  },
};

export const SUBSTATION_CAPEX = 32_000; // 变电站造价
export const SUBSTATION_RATING = 90; // 变电站变压器默认容量 (MW)
export const SUBSTATION_BUILD_DAYS = 1; // 变电站工期（天）
export const SUBSTATION_OM_PER_DAY = 80; // 变电站运维 ($/天)

// —— 储能规格（多类型：电池/抽蓄/氢储）——
export type StorageType = 'battery' | 'pumped' | 'hydrogen';
export interface StorageSpec {
  label: string;
  powerRating: number; // 充放电功率 (MW)
  energyCapacity: number; // 容量 (MWh)
  capex: number;
  buildDays: number; // 工期（天）
  omPerDay: number; // 运维 ($/天)
  roundTrip: number; // 往返效率
  capacityCredit: number; // 容量信用（长时储能更高）
  color: number;
}
export const STORAGE: Record<StorageType, StorageSpec> = {
  battery: { label: '电池储能', powerRating: 25, energyCapacity: 100, capex: 175_000, buildDays: 1.5, omPerDay: 120, roundTrip: 0.9, capacityCredit: 0.5, color: 0x4ade80 }, // ≈4h
  pumped: { label: '抽水蓄能', powerRating: 60, energyCapacity: 720, capex: 520_000, buildDays: 5, omPerDay: 300, roundTrip: 0.8, capacityCredit: 0.75, color: 0x38bdf8 }, // ≈12h
  hydrogen: { label: '氢储能', powerRating: 30, energyCapacity: 1800, capex: 480_000, buildDays: 4, omPerDay: 280, roundTrip: 0.4, capacityCredit: 0.55, color: 0xa78bfa }, // ≈60h 多日
};
export const BATTERY = STORAGE.battery; // 兼容旧引用

// —— 线路工期 ——
export const LINE_BUILD_DAYS_BASE = 0.4; // 线路基础工期
export const LINE_BUILD_DAYS_PER_TILE = 0.04; // 每瓦片附加工期

// —— 投资回报估算 ——
export const LCOE_LIFETIME_DAYS = 300; // 折旧寿命（游戏天），用于度电成本估算

// —— 燃料市场 ——
// 煤/气/铀价格以"指数"形式波动（1=基准）。新能源无燃料，不受影响。
export type FuelType = 'coal' | 'gas' | 'uranium';
export const PLANT_FUEL: Record<PlantType, FuelType | null> = {
  coal: 'coal', gas: 'gas', nuclear: 'uranium', wind: null, solar: null,
};
export const FUEL_INFO: Record<FuelType, { label: string; volatility: number }> = {
  coal: { label: '煤', volatility: 0.05 },
  gas: { label: '天然气', volatility: 0.11 }, // 天然气最敏感
  uranium: { label: '铀', volatility: 0.02 }, // 核燃料最稳定
};
export const FUEL_MEAN_REVERT = 0.06; // 向基准 1.0 回归速度（每天）
export const FUEL_MIN = 0.45;
export const FUEL_MAX = 2.6;
// 燃料价格的季节性基准偏移：深冬采暖需求推高天然气（与煤），核燃料几乎不受季节影响。
// 回归目标 = 1 + amp × 冬季强度，冬季最强、夏季/换季回到 1.0。
export const FUEL_SEASON_WINTER_AMP: Record<FuelType, number> = {
  coal: 0.1, // 煤：轻度冬季溢价
  gas: 0.35, // 天然气：强冬季溢价（采暖与电力争气）
  uranium: 0.0, // 铀：长约/库存制，无季节性
};
export const FUEL_SHOCK_CHANCE_PER_DAY = 0.12; // 燃料价格跳涨概率（每天）
export const FUEL_CONTRACT_PREMIUM = 1.03; // 燃料长约锁价相对现货的溢价（确定性的代价）

// —— 机组老化 / 强迫停运 / 退役 ——
export const WEAR_FULL_DAYS = 40; // 多少天磨损达到满值（1.0）
export const WEAR_COST_FACTOR = 0.3; // 满磨损时边际成本上浮比例
export const WEAR_OM_FACTOR = 0.6; // 满磨损时运维成本上浮比例
export const FAIL_BASE_HAZARD = 0.02; // 强迫停运基础日概率（再乘 0.3+磨损）
export const REPAIR_DAYS = 0.8; // 强迫停运检修时长（天）
export const REPAIR_COST_FRACTION = 0.04; // 检修成本 = capex × 此值 ×(0.5+磨损)
export const SALVAGE_FRACTION = 0.4; // 退役残值基准比例（占 capex）
export const DEPREC_DAYS = 60; // 残值随役龄折旧的天数尺度
export const MAINT_DAYS = 0.5; // 计划检修时长（天，短于强迫停运）
export const MAINT_COST_FRACTION = 0.06; // 计划检修成本 = capex × 此值
export const MAINT_AGE_REDUCTION_DAYS = 15; // 检修后役龄减少（大修返新）
// 季节性检修：淡季（春/秋）替代电力便宜→优惠；旺季（夏/冬）替代电力贵且削弱尖峰→加价
export const MAINT_SHOULDER_FACTOR = 0.75; // 换季检修成本系数（−25%）
export const MAINT_PEAK_FACTOR = 1.4; // 旺季检修成本系数（+40%）

// —— 设备保险 ——
export const INSURANCE_RATE_PER_DAY = 0.0008; // 日保费 = 资产账面价值 × 此值
export const INSURANCE_COVERAGE = 0.8; // 理赔覆盖比例（自付 20%）
export const STORM_DAMAGE = 9_000; // 风暴损毁线路的维修成本
// 季节性极端天气：夏季偏热浪/雷暴、冬季偏寒潮/无风/阴雨，旺季事件更强
export const WEATHER_HEAT_SUMMER_BOOST = 4; // 夏季热浪权重增益
export const WEATHER_COLD_WINTER_BOOST = 4; // 冬季寒潮权重增益
export const WEATHER_SEASON_INTENSITY = 0.3; // 旺季热浪/寒潮的额外需求强度

// —— 贷款 / 融资 ——
// 工期长、capex 高 → 前期现金流紧张。举债可摊平，但要付利息；信用额度随资产规模上升。
export const LOAN_BASE_CREDIT = 250_000; // 基础信用额度
export const LOAN_CREDIT_ASSET_FRAC = 0.6; // 资产可抵押比例
export const LOAN_BASE_DAILY_RATE = 0.004; // 基础日利率（0.4%/游戏天）
export const LOAN_RISK_SPREAD = 0.006; // 负债率风险溢价（最高再加 0.6%/天）
// 信用评级：由净资产/杠杆/可靠性/盈利综合而成，影响利率与融资上限。
export const RATING_RATE_SPAN = 0.012; // 评级对日利率的最大附加（最差评级 +1.2%/天）
export const RATING_REF_NETWORTH = 1_000_000; // 净资产评分参考
export const RATING_REF_PROFIT = 40_000; // 日均利润评分参考
export const ESG_RATE_DISCOUNT = 0.003; // ESG 满分时对日利率的最大折扣（−0.3%/天）

// —— 远期合约 / 套期保值 ——
// 锁定一部分电量的结算价（差价合约）：市价低于锁价时获补偿、高于时让出收益，平抑波动。
export const HEDGE_FEE_PER_MW_DAY = 1.5; // 套保手续费 ¥/(MW·天)，作为"保险费"
export const OPTION_PREMIUM_RATE = 2.6; // 期权权利金 ¥/(MW·天)（单向保护，比远期贵）

// —— 批发市场互联（联络线）——
// 自有电源不足时可向大市场购电补缺（按市场均价加价），避免停电但成本高。
export const INTERCONNECTOR_CAPACITY = 40; // 联络线容量 (MW)
export const IMPORT_MARKUP = 1.15; // 购电相对市场均价的加价
export const MARKET_FEE_PER_DAY = 1_200; // 联络线容量预留日费
export const EXPORT_WHEEL = 0.9; // 外送电价相对出清价的过网折扣
export const IMPORT_CARBON_INTENSITY = 0.5; // 进口电力的假定碳强度 (t/MWh)，用于碳关税

// —— 多区域市场（跨区价差套利）——
// 相邻区域(北/南)价格各异，连接后可跨区套利：买便宜区、卖昂贵区，赚价差减过网费。
export const ZONE_TRADE_CAPACITY = 30; // 跨区套利交易容量 (MW)
export const ZONE_WHEEL_FEE = 12; // 跨区过网费 ¥/MWh
export const ZONE_PERIOD_DAYS = 5; // 区域价格波动周期
export const ZONE_NORTH_OFFSET = -15; // 北区(便宜)相对出清价的偏移
export const ZONE_NORTH_AMP = 9;
export const ZONE_SOUTH_OFFSET = 16; // 南区(贵)相对出清价的偏移
export const ZONE_SOUTH_AMP = 11;
// 输电权(FTR)：金融合约，付远期价差权利金，收实际南北价差(拥堵租金)
export const FTR_MARKUP = 1.05; // 权利金相对当前价差的溢价

// —— 经济周期（景气循环）——
// 宏观繁荣/衰退周期性振荡，影响用电需求（进而影响电价/稀缺）。
export const CYCLE_PERIOD_DAYS = 8; // 周期长度（天）
export const CYCLE_AMPLITUDE = 0.15; // 对需求的振幅（±15%）

// —— 季节性（年度循环：需求与新能源随四季摆动；第 0 天为春，中性起点）——
export const SEASON_YEAR_DAYS = 24; // 一年的游戏天数（四季各约 6 天）
export const SEASON_SUMMER_DEMAND = 0.18; // 盛夏制冷高峰需求加成（+18%）
export const SEASON_WINTER_DEMAND = 0.12; // 深冬采暖高峰需求加成（+12%）
export const SEASON_SOLAR_AMP = 0.3; // 光伏季节摆幅（夏强冬弱 ±30%）
export const SEASON_WIND_AMP = 0.35; // 风电季节摆幅（冬强夏弱 ±35%）
export const SEASON_ADEQ_MARGIN = 0.1; // 迎峰预警阈值：可信容量备用率低于此即告警

// —— 长期规划压力测试（IRP：在现有机队上跑 what-if 情景，评估充裕度与经济韧性）——
export const IRP_LOAD_FACTOR = 0.72; // 平均负荷 / 峰值负荷
export const IRP_SUMMER_PEAK = 1 + SEASON_SUMMER_DEMAND; // 评估用夏季制冷峰乘子
export const IRP_SOLAR_PEAK_CREDIT = 0.05; // 光伏对晚峰的容量信用（很低）
export const IRP_WIND_PEAK_CREDIT = 0.15; // 风电对峰值的容量信用
export const IRP_RENEW_CF = 0.28; // 新能源平均容量因子（用于电量贡献估算）
export const IRP_TIGHT_MARGIN = 0.15; // 备用率低于此视为「偏紧」
export interface StressScenarioSpec {
  id: string;
  name: string;
  demandGrowth: number; // 峰值需求乘子
  renewDerate: number; // 新能源出力折减（1=正常）
  fuelMult: number; // 燃料价格乘子
  carbonMult: number; // 碳价乘子
}
export const IRP_SCENARIOS: StressScenarioSpec[] = [
  { id: 'base', name: '基准', demandGrowth: 1.0, renewDerate: 1.0, fuelMult: 1.0, carbonMult: 1.0 },
  { id: 'growth', name: '需求高增长', demandGrowth: 1.35, renewDerate: 1.0, fuelMult: 1.0, carbonMult: 1.0 },
  { id: 'fuel', name: '燃料飙升', demandGrowth: 1.0, renewDerate: 1.0, fuelMult: 1.6, carbonMult: 1.0 },
  { id: 'carbon', name: '碳价收紧', demandGrowth: 1.0, renewDerate: 1.0, fuelMult: 1.0, carbonMult: 2.5 },
  { id: 'drought', name: '新能源枯竭', demandGrowth: 1.0, renewDerate: 0.4, fuelMult: 1.0, carbonMult: 1.0 },
  { id: 'extreme', name: '极端高温叠加', demandGrowth: 1.45, renewDerate: 0.7, fuelMult: 1.3, carbonMult: 1.3 },
];

// —— 历史走势采样 ——
export const HISTORY_SAMPLE_HOURS = 2; // 采样间隔（游戏小时）
export const HISTORY_MAX = 160; // 最多保留样本数

// —— 多公司竞价市场 ——
// 你与若干 AI 竞争对手把发电按报价排序，对区域需求出清。出清边际成本决定市场价水平，
// 你的"市场份额"取决于是否够便宜——越有竞争力，获客增长越快。
export interface CompetitorSpec { name: string; capacity: number; marginalCost: number; }
export const REGIONAL_BASE_DEMAND = 520; // 区域市场基准需求 (MW)
export const COMPETITORS_INIT: CompetitorSpec[] = [
  { name: '绿源电力', capacity: 150, marginalCost: 6 }, // 廉价清洁基荷
  { name: '蓝煤集团', capacity: 200, marginalCost: 24 }, // 廉价火电基荷
  { name: '峰谷能源', capacity: 110, marginalCost: 56 }, // 昂贵调峰
];
export const GEN_MARGIN_MARKUP = 1.12; // 出清价相对边际成本的发电商加价
export const REGIONAL_SCARCITY_ADDER = 90; // 区域供不应求时的价格附加
export const COMPETITIVENESS_K = 2.0; // 市场份额对获客增长的影响系数
// 竞争对手动态：盈利则扩张、被挤出则退役（自平衡市场）
export const COMPETITOR_EXPAND_RATE = 0.02; // 盈利时每日扩张比例
export const COMPETITOR_RETIRE_RATE = 0.03; // 亏损时每日退役比例
export const COMPETITOR_EXPAND_MARGIN = 15; // 出清价高于成本多少才扩张
export const COMPETITOR_CAP_MIN_FRAC = 0.3; // 容量下限（占初始）
export const COMPETITOR_CAP_MAX_FRAC = 2.5; // 容量上限（占初始）
export const ACQUISITION_PRICE_PER_MW = 4_000; // 并购竞争对手的每 MW 估值
// 反垄断审查：并购按全网装机口径评估市场集中度
export const ANTITRUST_SOFT_SHARE = 0.45; // 并购后市占超过此值开始产生反垄断补救费
export const ANTITRUST_HARD_SHARE = 0.65; // 超过此值监管直接否决并购
export const ANTITRUST_PREMIUM_K = 1.5; // 补救费 = 基础估值 × K × 超额比例(0..1)

// —— 容量市场（容量拍卖）——
// 除卖电外，按"可用确定性容量"获容量补偿。容量价由拍卖出清：区域容量目标 vs 总可用容量，
// 紧张则容量价飙升（奖励建设）、过剩则归零——自我纠偏。
export const CAPACITY_PRICE_BASE = 4; // 容量基准价 ¥/(MW·天)
export const RESERVE_REQUIREMENT = 0.15; // 容量目标 = 峰值 ×(1+此值)
export const CAP_ADEQ_REF = 1.15; // 充裕度参考点（高于此则容量价折扣）
export const CAP_K = 3; // 容量价对充裕度的敏感度
export const CAP_PRICE_MIN_FRAC = 0.3; // 容量价下限系数
export const CAP_PRICE_MAX_FRAC = 2.2; // 容量价上限系数
export const CAPACITY_CREDIT: Record<PlantType, number> = {
  nuclear: 1, coal: 1, gas: 1, wind: 0.15, solar: 0.1, // 新能源容量信用低（非确定性）
};

// —— 碳捕集（CCS）改造 ——
// 给火电加装碳捕集：捕集大部分 CO2，但边际成本上升（能耗惩罚），并需改造投资。
export const CCS_CAPTURE_RATE = 0.9; // 捕集比例
export const CCS_COST_FACTOR = 1.4; // 边际成本上浮系数
export const CCS_CAPEX_PER_MW = 4_500; // 改造成本 ¥/MW

// —— 输电阻塞（节点价差）——
// 线路接近热极限即产生阻塞成本（再调度/节点价差），奖励就近发电与扩建输电。
export const CONGESTION_THRESHOLD = 0.7; // 超过此负载率开始计阻塞
export const CONGESTION_PRICE = 8; // 阻塞费 ¥/(MW·MWh 超额)

// —— 需求响应（可中断负荷）——
// 高价时段付激励让用户自愿削减用电，平抑尖峰、替代昂贵调峰/购电。
export const DR_FRACTION = 0.12; // 可削减的需求比例
export const DR_TRIGGER_PRICE = 110; // 现货价高于此触发需求响应
export const DR_INCENTIVE = 90; // 削减激励 ¥/MWh（低于峰荷供电成本）

// —— 辅助服务市场（调频 + 运行备用，竞价出清）——
// 系统调频/备用需求∝区域需求；供给=你+竞争对手的快速/闲置容量。紧张则价高。
export const AS_REG_PRICE_BASE = 6; // 调频基准价 ¥/(MW·天)
export const AS_RESERVE_PRICE_BASE = 2.5; // 备用基准价 ¥/(MW·天)
export const AS_GAS_REG_FACTOR = 0.5; // 燃气可提供调频的容量比例
export const AS_REG_REQ_FRAC = 0.10; // 调频需求占区域需求比例
export const AS_RESERVE_REQ_FRAC = 0.20; // 备用需求占区域需求比例
export const RENEW_RESERVE_K = 0.8; // 新能源占比对运行备用需求的放大系数（满清洁时 +80%，覆盖预测误差）
// —— 灵活性/爬坡市场：净负荷波动越大，越需快速可调资源（燃气/储能）提供爬坡 ——
export const FLEX_PRICE_BASE = 3.5; // 灵活性基准价 ¥/(MW·天)
export const FLEX_BASE_FRAC = 0.05; // 基础灵活性需求占区域需求比例
export const FLEX_RENEW_FACTOR = 0.6; // 新能源渗透率对灵活性需求的附加（净负荷波动代理）
export const FLEX_COMP_FRAC = 0.08; // 竞争对手快速资源计入灵活性供给的比例
export const FLEX_ADEQ_REF = 1.2; // 灵活性供需充裕参考点
export const FLEX_K = 2.5; // 灵活性价格对充裕度的敏感度
export const FLEX_PRICE_MIN = 0.4; // 灵活性价下限系数
export const FLEX_PRICE_MAX = 3.0; // 灵活性价上限系数
// —— 储能价差套利：低价充电/高价放电赚取现货价差，旺季价差更宽 ——
export const STORAGE_ARB_CAPTURE = 0.5; // 价差套利的捕获比例（市场摩擦/损耗后）
export const STORAGE_ARB_SEASON_K = 0.6; // 旺季价差更宽的套利季节增益
// —— 可中断负荷合同：付季节性可用费，把大用户可中断负荷作为备用/容量资源 ——
export const INTERRUPT_RATE_BASE = 2.0; // 可中断负荷可用费基准 ¥/(MW·天)
export const INTERRUPT_SEASON_K = 0.8; // 旺季可用费增益（旺季更贵）
export const AS_COMP_FAST_FRAC = 0.05; // 竞争对手可提供调频的容量比例（仅少量机组快速）
export const AS_COMP_RESERVE_FRAC = 0.10; // 竞争对手可提供备用的容量比例
export const AS_ADEQ_REF = 1.2; // 充裕度参考点
export const AS_K = 2.5; // 价格对充裕度的敏感度
export const AS_PRICE_MIN = 0.4; // 价格下限系数
export const AS_PRICE_MAX = 3.0; // 价格上限系数

// —— 远期容量拍卖 ——
// 提前承诺一定容量、锁定容量价（差价合约），平抑容量价波动；但负有交付义务，欠交付罚款。
export const FORWARD_CAP_PREMIUM = 1.1; // 远期容量锁价相对现货容量价的溢价
export const CAP_DELIVERY_PENALTY = 14; // 欠交付罚款 ¥/(MW·天)

// —— 现货电价（随稀缺与燃料动态定价）——
// 备用率（可用容量/需求）越低、边际机组越贵 → 电价越高；峰时/缺供出现价格尖峰。
// 这让"调峰机组"和"储能套利"有了真实收益来源。
export const SPOT = {
  floor: 18, // 价格下限 ¥/MWh
  cap: 240, // 价格上限 ¥/MWh
  scarcityRef: 1.35, // 备用率参考点（高于此价格不再溢价）
  scarcityK: 2.2, // 稀缺敏感度
  multMin: 0.9, // 稀缺乘子下限（过剩时小幅折价）
  multMax: 3.2, // 稀缺乘子上限
  fuelRef: 90, // 燃料影响参考（边际成本/此值）
  fuelMin: 0.85, // 燃料影响下限（全清洁电力时）
  fuelMax: 1.6, // 燃料影响上限
};

// —— 电压等级规格 ——
// HV 高压输电：损耗低、容量大、造价高；MV 中压配电：损耗高、容量小、造价低。
// 这就是"为什么要升压远距离输电、再降压配电"的玩法动机。
export interface VoltageSpec {
  label: string;
  defaultCapacity: number; // 线路默认热极限 (MW)
  lossScale: number; // 线损系数：loss ≈ R·flow²·lossScale
  costPerTile: number; // 每瓦片造价
  color: number; // 渲染基色
}
export const VOLTAGE: Record<VoltageClass, VoltageSpec> = {
  HV: { label: '高压输电', defaultCapacity: 170, lossScale: 0.004, costPerTile: 2_600, color: 0x6fd3ff },
  MV: { label: '中压配电', defaultCapacity: 70, lossScale: 0.02, costPerTile: 1_400, color: 0xb7c2cc },
};

// —— 电气常量 ——
export const X_PER_TILE = 0.018; // 单位长度电抗
export const R_PER_TILE = 0.004; // 单位长度电阻
export const MAX_LOSS_FRACTION = 0.12; // 线损上限（占潮流比例），防数值发散

// —— 经济常量 ——
export const START_MONEY = 600_000;
export const TARIFF = 64; // 基准电价 $/MWh（实际送达用户即可收费）
// 分类电价系数：居民小用户付溢价、工业大用户享批发折扣、商业居中。
export const TARIFF_CLASS: Record<LoadProfile, number> = {
  residential: 1.25, commercial: 1.0, industrial: 0.8,
};
export const UNSERVED_PENALTY = 240; // 失负荷罚款 $/MWh（停电代价远高于电价）
export const CARBON_PRICE_START = 4; // 配额价 $/吨，随时间上涨
export const CARBON_PRICE_GROWTH_PER_DAY = 0.6;
// 碳配额交易（基准分配）：按送达电量免费发放排放配额，基准强度随时间收紧。
// 排放强度低于基准 → 卖出富余配额获利；高于基准 → 买入配额付费。
export const CARBON_BENCH_START = 0.55; // 基准排放强度起点 (t/MWh)
export const CARBON_BENCH_DECLINE_PER_DAY = 0.02; // 每天收紧
export const CARBON_BENCH_MIN = 0.1; // 基准下限

// 绿色证书（REC）：新能源发电按绿证价获补贴收入，价格随政策退坡。
export const REC_START = 22; // 绿证起始价 ¥/MWh
export const REC_DECLINE_PER_DAY = 0.4; // 每天退坡
export const REC_MIN = 4; // 绿证价下限

// —— 公众形象 / 口碑 ——
export const POLLUTION_RADIUS = 5; // 火电厂污染影响半径（瓦片）
export const REP_TARIFF_MIN = 0.85; // 口碑 0 时电价系数
export const REP_TARIFF_SPAN = 0.3; // 口碑 0→100 额外电价系数（最高 1.15）
export const REP_UNSERVED_WEIGHT = 120; // 停电对口碑的压制
export const REP_CARBON_WEIGHT = 22; // 碳强度对口碑的压制
export const REP_POLLUTION_WEIGHT = 25; // 临近居民的火电污染对口碑的压制
export const REP_TIME_CONSTANT = 8; // 口碑变化时间常数（小时）

// —— 运行/保护常量 ——
export const FREQ_NOMINAL = 50; // 额定频率 Hz
export const FREQ_DROOP = 1.6; // 频率对供需失衡的灵敏度
export const FREQ_SHED_THRESHOLD = 49.0; // 低于此频率触发低频减载
export const TRIP_DELAY = 22; // 持续过载多少仿真秒后跳闸
export const TIME_SCALES = [0, 1440, 2880, 5760]; // 暂停 / 1x / 2x / 4x（仿真秒 / 真实秒），1x 下约 60 真实秒 = 1 天

// —— 黑启动与停电恢复（全黑后逐步恢复，黑启动资源加速；软恢复，永不永久卡死）——
export const BLACKSTART_TYPES: Record<PlantType, boolean> = {
  gas: true, // 燃气机组可自启动，充当黑启动种子
  nuclear: false, coal: false, wind: false, solar: false, // 需外部电源启动辅机/缺乏调频
};
export const RESTORE_FAST_RATE = 4.0; // 有黑启动资源时每小时恢复的能量化比例（≈15 分钟全恢复）
export const RESTORE_SLOW_RATE = 0.5; // 无黑启动资源时（靠外部联络/人工）的恢复速率（≈2 小时）
export const BLACKOUT_DROP_RATE = 30; // 全黑时能量化骤降速率（≈瞬时）

// —— 胜负目标（MVP 关卡：把小镇带到繁荣） ——
export const WIN_DAY = 12; // 撑过第 12 天即获胜
export const WIN_RELIABILITY = 0.92; // 且可靠性需达标

// —— 关卡评分（通关后给出 S/A/B/C/D 星级，综合可靠性/财务/清洁/口碑） ——
export const GRADE_NETWORTH_REF = 3_000_000; // 净资产满分参考
export const GRADE_W_RELIABILITY = 0.40; // 可靠性权重
export const GRADE_W_FINANCE = 0.25; // 财务权重
export const GRADE_W_CLEAN = 0.20; // 清洁占比权重
export const GRADE_W_REPUTATION = 0.15; // 口碑权重
