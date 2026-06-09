// 组件目录与全局经济/物理常量。所有可调平衡数值集中在这里，方便调参。
import type { PlantType } from '../sim/types';

export interface PlantSpec {
  type: PlantType;
  label: string;
  capacity: number; // MW
  pmin: number; // MW
  rampRate: number; // MW / 仿真秒（火电慢、燃气快、核电极慢、新能源不限）
  marginalCost: number; // $/MWh
  capex: number; // 一次性建造成本 $
  dispatchable: boolean;
  co2: number; // 吨 / MWh
  color: number; // 渲染颜色
  desc: string;
}

// 数值刻意区分出"基荷/调峰/间歇"三类角色，构成核心组合谜题。
export const PLANTS: Record<PlantType, PlantSpec> = {
  nuclear: {
    type: 'nuclear', label: '核电', capacity: 120, pmin: 80, rampRate: 0.08,
    marginalCost: 10, capex: 820_000, dispatchable: true, co2: 0,
    color: 0xa78bfa, desc: '巨大基荷·投资高·几乎不可调',
  },
  coal: {
    type: 'coal', label: '燃煤', capacity: 60, pmin: 18, rampRate: 0.35,
    marginalCost: 26, capex: 230_000, dispatchable: true, co2: 0.95,
    color: 0x9aa4ad, desc: '便宜基荷·爬坡慢·高排放',
  },
  gas: {
    type: 'gas', label: '燃气', capacity: 40, pmin: 0, rampRate: 2.2,
    marginalCost: 58, capex: 110_000, dispatchable: true, co2: 0.45,
    color: 0xf2994a, desc: '灵活调峰·爬坡快·燃料贵',
  },
  wind: {
    type: 'wind', label: '风电', capacity: 30, pmin: 0, rampRate: 999,
    marginalCost: 0, capex: 150_000, dispatchable: false, co2: 0,
    color: 0x56ccf2, desc: '零燃料·看风·夜间也可发',
  },
  solar: {
    type: 'solar', label: '光伏', capacity: 30, pmin: 0, rampRate: 999,
    marginalCost: 0, capex: 125_000, dispatchable: false, co2: 0,
    color: 0xf2c94c, desc: '零燃料·只在白天·午间最强',
  },
};

export const SUBSTATION_CAPEX = 28_000; // 变电站造价
export const LINE_COST_PER_TILE = 1_900; // 线路每瓦片造价
export const LINE_DEFAULT_CAPACITY = 90; // 新建线路默认热极限 (MW)

// —— 电气常量 ——
export const X_PER_TILE = 0.018; // 单位长度电抗
export const R_PER_TILE = 0.004; // 单位长度电阻
export const LOSS_SCALE = 0.012; // 线损系数：loss ≈ R * flow^2 * LOSS_SCALE
export const MAX_LOSS_FRACTION = 0.12; // 线损上限（占潮流比例），防数值发散

// —— 经济常量 ——
export const START_MONEY = 600_000;
export const TARIFF = 64; // 上网电价 $/MWh（实际送达用户即可收费）
export const UNSERVED_PENALTY = 240; // 失负荷罚款 $/MWh（停电代价远高于电价）
export const CARBON_PRICE_START = 4; // 碳价 $/吨，随时间上涨制造减碳压力
export const CARBON_PRICE_GROWTH_PER_DAY = 0.6;

// —— 运行/保护常量 ——
export const FREQ_NOMINAL = 50; // 额定频率 Hz
export const FREQ_DROOP = 1.6; // 频率对供需失衡的灵敏度
export const FREQ_SHED_THRESHOLD = 49.0; // 低于此频率触发低频减载
export const TRIP_DELAY = 22; // 持续过载多少仿真秒后跳闸
export const TIME_SCALES = [0, 1440, 2880, 5760]; // 暂停 / 1x / 2x / 4x（仿真秒 / 真实秒），1x 下约 60 真实秒 = 1 天

// —— 胜负目标（MVP 关卡：把小镇带到繁荣） ——
export const WIN_DAY = 12; // 撑过第 12 天即获胜
export const WIN_RELIABILITY = 0.92; // 且可靠性需达标
