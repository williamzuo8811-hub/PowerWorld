// 电力世界 · 领域类型定义
// 整个仿真核心是纯数据 + 纯函数，不依赖任何渲染库，便于单元测试与替换前端。

/** 母线（电网节点）的种类 */
export type BusKind = 'plant' | 'substation' | 'load' | 'storage';

/** 机组类型 */
export type PlantType = 'coal' | 'gas' | 'wind' | 'solar' | 'nuclear';

/** 负荷画像（决定一天内的用电曲线） */
export type LoadProfile = 'residential' | 'commercial' | 'industrial';

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
}

/** 储能电池（双向：放电=电源，充电=负荷） */
export interface Battery {
  id: number;
  busId: number;
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
  gameOver: boolean;
  win: boolean;
}
