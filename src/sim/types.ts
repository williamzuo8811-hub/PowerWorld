// 电力世界 · 领域类型定义
// 整个仿真核心是纯数据 + 纯函数，不依赖任何渲染库，便于单元测试与替换前端。

/** 母线（电网节点）的种类 */
export type BusKind = 'plant' | 'substation' | 'load' | 'storage';

/** 机组类型 */
export type PlantType = 'coal' | 'gas' | 'wind' | 'solar' | 'nuclear';

/** 负荷画像（决定一天内的用电曲线）。后四类为可招商引资的"大客户" */
export type LoadProfile = 'residential' | 'commercial' | 'industrial' | 'datacenter' | 'transport' | 'petrochem' | 'mining';

/** 电压等级：HV=高压输电（低损耗、大容量、贵）；MV=中压配电（高损耗、小容量、便宜） */
export type VoltageClass = 'HV' | 'MV';

/**
 * 母线 / 节点。电厂、变电站、负荷都挂在某个母线上。
 * 在直流潮流里，母线就是图的顶点。
 */
export interface Bus {
  id: number;
  name: string;
  kind: BusKind;
  x: number; // 世界坐标（瓦片单位）
  y: number;
  /** 本 tick 是否处于停电（所在孤岛无电源 / 被甩负荷） */
  blackout: boolean;
  /** 能量化程度 0..1：全黑后逐步恢复，黑启动资源加速恢复（停电恢复 / 冷负荷启动） */
  energized?: number;
  /** 本 tick 电压（标幺值 pu）：由所在孤岛的无功平衡近似得出，<1 表示欠压 */
  voltage?: number;
  /** 是否加装电容器组（无功补偿，支撑电压）——变电站专用 */
  capacitor?: boolean;
  // —— 建设工期（电厂/变电站/储能）——
  underConstruction?: boolean; // 在建中：已付 capex 但尚未投运
  commissionAt?: number; // 投运时刻（累计仿真小时）
  // —— 变电站专用字段（其余母线忽略）——
  rating?: number; // 变压器额定容量 (MW)：HV→MV 降压通过能力
  throughput?: number; // 本 tick 经变压器下送的功率 (MW)
  transformerTripped?: boolean; // 变压器是否过载跳闸（切断 MV 侧）
  transformerTimer?: number; // 持续过载累计时间（仿真秒）
}

/** 发电机组（挂在某条母线上） */
export interface Generator {
  id: number;
  busId: number;
  type: PlantType;
  capacity: number; // 额定容量 Pmax (MW)
  pmin: number; // 最小技术出力 (MW)
  output: number; // 当前出力 (MW)
  rampRate: number; // 爬坡率 (MW / 仿真秒)
  marginalCost: number; // 边际（燃料）成本 ($/MWh)
  dispatchable: boolean; // 是否可调度（火电/核电=是；风/光=否，靠天吃饭）
  availability: number; // 0..1，本 tick 可用出力系数（新能源由天气决定）
  age: number; // 役龄（游戏天，投运后累计）—— 老化用
  outageUntil?: number; // 强迫停运结束时刻（累计仿真小时），其间离线
  ccs?: boolean; // 是否加装碳捕集（捕碳但边际成本上升）
  committed?: boolean; // 机组组合：是否已并网在线（用于启停成本/最小开停机）
  commitLockUntil?: number; // 当前开/停机状态的锁定到期时刻（最小开/停机时间）
  startups?: number; // 累计冷启动次数（统计）
}

/** 储能（双向：放电=电源，充电=负荷）。多类型：电池/抽蓄/氢储 */
export interface Battery {
  id: number;
  busId: number;
  type: import('../config/components').StorageType; // 储能类型
  powerRating: number; // 充放电功率上限 (MW)
  energyCapacity: number; // 能量容量 (MWh)
  soc: number; // 当前储能 (MWh)
  output: number; // 本 tick 出力 (MW)：放电为正、充电为负
  roundTrip: number; // 往返效率 0..1（充电按此打折计入 SoC）
}

/** 负荷（用电需求，挂在某条母线上） */
export interface Load {
  id: number;
  busId: number;
  profile: LoadProfile;
  baseDemand: number; // 峰值基准需求 (MW)，随城市发展增长
  demand: number; // 本 tick 期望需求 (MW)
  served: number; // 本 tick 实际供电 (MW)
  growthPerHour: number; // 每仿真小时的复合增长率
  satisfaction?: number; // 客户满意度 0..1（供电充足率的滑动平均）—— 大客户流失判定
  churnTimer?: number; // 低满意累积时长（仿真小时）—— 超阈值则流失
  churnWarned?: boolean; // 是否已发过挖角预警（边沿触发，恢复后重置）
  backup?: boolean; // 是否自备应急电源（UPS/柴发），兜底部分负荷、缓解停电
  contractEndClock?: number; // 长约到期时刻（仿真小时）：合约期内不被挖角、电价折让
}

/** 线路（图的边）。可以是输电线，也可以是配电线，区别只在电压/容量/造价。 */
export interface Line {
  id: number;
  from: number; // 母线 id
  to: number; // 母线 id
  voltage: VoltageClass; // 电压等级：由两端母线类型自动决定
  reactance: number; // 电抗 X（∝ 长度），决定潮流如何分配
  resistance: number; // 电阻 R（∝ 长度），决定线损
  capacity: number; // 热极限 (MW)
  length: number; // 长度（瓦片）
  // —— 动态量 ——
  flow: number; // 当前潮流 (MW)，from→to 为正
  loss: number; // 当前线损 (MW)
  tripped: boolean; // 是否已跳闸（过载保护动作）
  overloadTimer: number; // 持续过载累计时间（仿真秒）
  underConstruction?: boolean; // 在建中：尚未导通
  commissionAt?: number; // 投运时刻（累计仿真小时）
}

/** 一条日志/告警 */
export interface LogEntry {
  time: number; // 仿真小时
  level: 'info' | 'warn' | 'bad' | 'good';
  msg: string;
}

/** 仿真对外暴露的只读快照（给 HUD 用） */
export interface SimSnapshot {
  clock: number; // 仿真小时（累计）
  day: number;
  hourOfDay: number;
  money: number;
  frequency: number; // 主电网频率 (Hz)
  totalGen: number; // 总发电 (MW)
  totalDemand: number; // 总需求 (MW)
  totalServed: number; // 实际供电 (MW)
  totalLoss: number; // 总线损 (MW)
  co2: number; // 当前碳排放强度 (吨/h)
  reliability: number; // 近期可靠性 0..1（供电率滑动平均）
  weather: string; // 当前天气/事件标签
  demandFactor: number; // 事件造成的需求系数（>1 表示尖峰）
  goalDay: number; // 关卡目标：撑到第几天
  goalReliability: number; // 关卡目标：可靠性阈值
  researchPoints: number; // 当前研发点
  reputation: number; // 公众形象 0..100
  renewableShare: number; // 清洁电力占比 0..1（新能源+储能）
  cycle: string; // 景气阶段（繁荣/平稳/衰退）
  cycleFactor: number; // 景气需求系数
  season: string; // 季节（春/夏/秋/冬）
  seasonFactor: number; // 季节需求系数
  committedUnits: number; // 已并网可调机组数
  dispatchableUnits: number; // 可调机组总数（已投运）
  startupsTotal: number; // 累计机组启动次数
  marketShare: number; // 区域市场发电份额 0..1
  marketClearingPrice: number; // 区域出清价（批发）
  regionalDemand: number; // 区域市场总需求 MW
  spotPrice: number; // 当前现货电价 ¥/MWh
  reserveMargin: number; // 备用率（可用容量/需求）
  fuelPrice: Record<'coal' | 'gas' | 'uranium', number>; // 燃料价格指数
  debt: number; // 未偿贷款
  creditLimit: number; // 信用额度
  netWorth: number; // 净资产
  assetValue: number; // 资产账面价值
  sandbox: boolean; // 是否沙盒模式
  gameOver: boolean;
  win: boolean;
  grade: string; // 综合星级 S/A/B/C/D
  gradeScore: number; // 综合评分 0..100
  blackStartCapable: boolean; // 是否具备黑启动能力（燃气/储能种子）
  gridEnergized: number; // 全网能量化程度 0..1（<1=停电恢复中）
  outageEnergyTotal: number; // 累计失负荷电量 (MWh)
  voltage: number; // 主电网电压（pu）
  customerSatisfaction: number; // 大客户加权满意度 0..1
}
