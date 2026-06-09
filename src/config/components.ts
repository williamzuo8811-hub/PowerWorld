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
  color: number; // 渲染颜色
  desc: string;
}

// 数值刻意区分出"基荷/调峰/间歇"三类角色，并加入工期/运维，构成"投资 vs 收益"权衡。
export const PLANTS: Record<PlantType, PlantSpec> = {
  nuclear: {
    type: 'nuclear', label: '核电', capacity: 120, pmin: 80, rampRate: 0.08,
    marginalCost: 10, capex: 820_000, buildDays: 8, omPerDay: 1_200, cf: 0.9, dispatchable: true, co2: 0,
    color: 0xa78bfa, desc: '巨大基荷·投资高·工期最长·几乎不可调',
  },
  coal: {
    type: 'coal', label: '燃煤', capacity: 60, pmin: 18, rampRate: 0.35,
    marginalCost: 26, capex: 230_000, buildDays: 4, omPerDay: 600, cf: 0.6, dispatchable: true, co2: 0.95,
    color: 0x9aa4ad, desc: '便宜基荷·爬坡慢·高排放',
  },
  gas: {
    type: 'gas', label: '燃气', capacity: 40, pmin: 0, rampRate: 2.2,
    marginalCost: 58, capex: 110_000, buildDays: 1.5, omPerDay: 250, cf: 0.25, dispatchable: true, co2: 0.45,
    color: 0xf2994a, desc: '工期短·灵活调峰·爬坡快·燃料贵',
  },
  wind: {
    type: 'wind', label: '风电', capacity: 30, pmin: 0, rampRate: 999,
    marginalCost: 0, capex: 150_000, buildDays: 3, omPerDay: 200, cf: 0.35, dispatchable: false, co2: 0,
    color: 0x56ccf2, desc: '零燃料·工期较长·看风·夜间也可发',
  },
  solar: {
    type: 'solar', label: '光伏', capacity: 30, pmin: 0, rampRate: 999,
    marginalCost: 0, capex: 125_000, buildDays: 2, omPerDay: 150, cf: 0.2, dispatchable: false, co2: 0,
    color: 0xf2c94c, desc: '零燃料·工期中等·只在白天·午间最强',
  },
};

export const SUBSTATION_CAPEX = 32_000; // 变电站造价
export const SUBSTATION_RATING = 90; // 变电站变压器默认容量 (MW)
export const SUBSTATION_BUILD_DAYS = 1; // 变电站工期（天）
export const SUBSTATION_OM_PER_DAY = 80; // 变电站运维 ($/天)

// —— 储能电池规格 ——
export const BATTERY = {
  label: '储能',
  powerRating: 25, // 充放电功率 (MW)
  energyCapacity: 100, // 容量 (MWh) ≈ 满功率 4 小时
  capex: 175_000,
  buildDays: 1.5, // 工期（天）
  omPerDay: 120, // 运维 ($/天)
  roundTrip: 0.9, // 往返效率
  color: 0x4ade80,
};

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
export const FUEL_SHOCK_CHANCE_PER_DAY = 0.12; // 燃料价格跳涨概率（每天）

// —— 机组老化 / 强迫停运 / 退役 ——
export const WEAR_FULL_DAYS = 40; // 多少天磨损达到满值（1.0）
export const WEAR_COST_FACTOR = 0.3; // 满磨损时边际成本上浮比例
export const WEAR_OM_FACTOR = 0.6; // 满磨损时运维成本上浮比例
export const FAIL_BASE_HAZARD = 0.02; // 强迫停运基础日概率（再乘 0.3+磨损）
export const REPAIR_DAYS = 0.8; // 强迫停运检修时长（天）
export const REPAIR_COST_FRACTION = 0.04; // 检修成本 = capex × 此值 ×(0.5+磨损)
export const SALVAGE_FRACTION = 0.4; // 退役残值基准比例（占 capex）
export const DEPREC_DAYS = 60; // 残值随役龄折旧的天数尺度

// —— 贷款 / 融资 ——
// 工期长、capex 高 → 前期现金流紧张。举债可摊平，但要付利息；信用额度随资产规模上升。
export const LOAN_BASE_CREDIT = 250_000; // 基础信用额度
export const LOAN_CREDIT_ASSET_FRAC = 0.6; // 资产可抵押比例
export const LOAN_BASE_DAILY_RATE = 0.004; // 基础日利率（0.4%/游戏天）
export const LOAN_RISK_SPREAD = 0.006; // 负债率风险溢价（最高再加 0.6%/天）

// —— 远期合约 / 套期保值 ——
// 锁定一部分电量的结算价（差价合约）：市价低于锁价时获补偿、高于时让出收益，平抑波动。
export const HEDGE_FEE_PER_MW_DAY = 1.5; // 套保手续费 ¥/(MW·天)，作为"保险费"

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

// —— 胜负目标（MVP 关卡：把小镇带到繁荣） ——
export const WIN_DAY = 12; // 撑过第 12 天即获胜
export const WIN_RELIABILITY = 0.92; // 且可靠性需达标
