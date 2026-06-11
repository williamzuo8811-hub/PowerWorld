// 战役关卡定义。每个关卡设定起始资金、目标、初始电网与电源布局。
// 关卡类型不只有"撑 X 天"：残局修复 / 预算约束 / 剧本事件链 / 大停电考古
// 通过 sim.objectives（附加目标）、sim.loanBan（禁贷）、sim.scriptedWeather（剧本天气）实现差异化玩法。
import type { Simulation } from '../sim/simulation';

export interface Scenario {
  id: string;
  name: string;
  brief: string;
  hint: string;
  goals?: string; // 评分目标提示（追求高星级的方向）
  setup(sim: Simulation): void;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'town',
    name: '① 点亮小镇',
    brief: '经典上手关。把三个城区接入电网，撑过 12 天且可靠性≥92%。起步赠送一座燃煤与中心变电站。',
    hint: '① 选「拉线路」把商业区/工业区接入  ② 备足电源  ③ 点 ▶ 或按空格开始',
    setup(sim) {
      sim.money = 780_000; // 含建设工期/运维等经济摩擦的现金垫
      sim.goalDay = 12;
      sim.goalReliability = 0.92;
      const g = sim.grid;
      const res = g.addLoad(14, 4, 'residential', 26, '居民区', 0.0045);
      g.addLoad(16, 12, 'commercial', 20, '商业区', 0.005);
      g.addLoad(6, 15, 'industrial', 34, '工业区', 0.0038);
      const coal = g.addPlant('coal', 5, 5).bus;
      const sub = g.addSubstation(10, 8, '中心变电站');
      g.addLine(coal.id, sub.id); // HV
      g.addLine(sub.id, res.bus.id); // MV
      sim.log('info', '【点亮小镇】把商业区、工业区接入电网，备足电源后开始。');
    },
  },
  {
    id: 'green',
    name: '② 绿色新城',
    brief: '更大的城市、更高的需求。只给一台燃气起步——多用风光与储能消纳，撑过 14 天且可靠性≥90%。',
    hint: '需求很高且会增长：善用风电/光伏 + 储能平峰，注意线损与变电站容量。',
    setup(sim) {
      sim.money = 1_120_000;
      sim.goalDay = 14;
      sim.goalReliability = 0.9;
      const g = sim.grid;
      g.addLoad(17, 5, 'residential', 34, '新城居民', 0.005);
      g.addLoad(21, 12, 'commercial', 26, '商务区', 0.0055);
      g.addLoad(9, 14, 'industrial', 40, '产业园', 0.004);
      g.addLoad(25, 16, 'residential', 24, '卫星城', 0.006);
      const sub = g.addSubstation(16, 10, '枢纽变电站');
      const gas = g.addPlant('gas', 11, 6).bus;
      g.addLine(gas.id, sub.id);
      sim.log('info', '【绿色新城】需求高且增长快——多用风光储，撑到第 14 天。');
    },
  },
  {
    id: 'storm',
    name: '③ 风暴季',
    brief: '频繁的天气冲击与线路损毁。电网已搭好但脆弱（单一变电站=单点故障）。建冗余与储能保供电，撑过 10 天且可靠性≥88%。',
    hint: '风暴会损毁线路、热浪会拉高需求：建冗余线路/第二座变电站 + 储能，随时「重合闸」。',
    setup(sim) {
      sim.money = 680_000;
      sim.goalDay = 10;
      sim.goalReliability = 0.88;
      const g = sim.grid;
      const r1 = g.addLoad(15, 5, 'residential', 28, '城东', 0.004);
      const c1 = g.addLoad(18, 13, 'commercial', 22, '城南', 0.004);
      const i1 = g.addLoad(8, 13, 'industrial', 30, '重工区', 0.003);
      const coal = g.addPlant('coal', 5, 6).bus;
      const sub = g.addSubstation(11, 9, '主变电站');
      g.addLine(coal.id, sub.id);
      g.addLine(sub.id, r1.bus.id);
      g.addLine(sub.id, c1.bus.id);
      g.addLine(sub.id, i1.bus.id);
      sim.events.nextAt = sim.clock + 4; // 风暴季：很快就有第一场事件
      sim.log('info', '【风暴季】频繁天气冲击！建冗余与储能保供电，撑到第 10 天。');
    },
  },
  {
    id: 'lowcarbon',
    name: '④ 碳中和转型',
    brief: '碳价高企（×2.5）：纯火电会被碳成本压垮。多上风光储、必要时给火电加 CCS，向清洁电力转型，撑过 14 天且可靠性≥90%。',
    hint: '碳价很高：燃煤碳成本巨大——加快风光储并网、给火电加 CCS，提升清洁占比换取高星级。',
    goals: '高星级 = 高可靠性 + 盈利 + 高清洁占比 + 好口碑（清洁转型尤为关键）',
    setup(sim) {
      sim.money = 1_350_000;
      sim.goalDay = 14;
      sim.goalReliability = 0.9;
      sim.carbonPriceMult = 2.5; // 碳中和压力
      const g = sim.grid;
      g.addLoad(15, 5, 'residential', 30, '低碳新区', 0.0045);
      g.addLoad(19, 12, 'commercial', 24, '商务区', 0.005);
      g.addLoad(8, 14, 'industrial', 32, '产业园', 0.0038);
      const coal = g.addPlant('coal', 5, 6).bus; // 起步火电，但碳成本高
      const sub = g.addSubstation(12, 9, '枢纽变电站');
      g.addLine(coal.id, sub.id);
      sim.log('info', '【碳中和转型】碳价高企——加快清洁电力与 CCS，撑到第 14 天。');
    },
  },
  {
    id: 'summer',
    name: '⑤ 迎峰度夏',
    brief: '开局即盛夏：制冷高峰 + 频繁热浪，气价也偏高。备足可信容量与储能顶峰，撑过 12 天（跨夏入秋）且可靠性≥90%。',
    hint: '夏季峰值高、热浪频发：用「迎峰预警」校核可信容量，备足调峰/储能/可中断负荷顶尖峰。',
    goals: '高星级 = 顶住夏季尖峰的高可靠性 + 盈利 + 清洁占比 + 口碑',
    setup(sim) {
      sim.money = 1_200_000;
      sim.clock = 6 * 24; // 第 6 天 = 盛夏相位
      sim.goalDay = 18; // 再撑 12 天
      sim.goalReliability = 0.9;
      const g = sim.grid;
      g.addLoad(15, 5, 'residential', 32, '城东居民', 0.004);
      g.addLoad(19, 13, 'commercial', 28, '商业中心', 0.0045);
      g.addLoad(8, 13, 'industrial', 30, '工业区', 0.0035);
      const coal = g.addPlant('coal', 5, 6).bus;
      const gas = g.addPlant('gas', 7, 4).bus; // 一台调峰燃气起步
      const sub = g.addSubstation(12, 9, '主变电站');
      g.addLine(coal.id, sub.id);
      g.addLine(gas.id, sub.id);
      sim.events.nextAt = sim.clock + 5;
      sim.log('info', '【迎峰度夏】盛夏开局，制冷高峰 + 热浪——备足可信容量与储能，撑到第 18 天。');
    },
  },
  {
    id: 'keyaccount',
    name: '⑥ 能源大客户',
    brief: '服务高要求大客户：数据中心(最怕停电)、远郊矿区(长线易欠压)、石化基地(可中断)。备可靠电源/无功补偿/黑启动种子，撑过 14 天且可靠性≥91%。',
    hint: '数据中心停电=SLA重罚→建冗余/储能/黑启动；远郊矿区长线远供→欠压→加电容器组或就近电源；石化可在高价时段被中断。',
    goals: '高星级=高可靠(护住数据中心) + 盈利(大客户大单) + 清洁 + 口碑',
    setup(sim) {
      sim.money = 1_500_000;
      sim.goalDay = 14;
      sim.goalReliability = 0.91;
      const g = sim.grid;
      g.addLoad(15, 6, 'commercial', 22, '商务区', 0.004);
      g.addLoad(17, 12, 'datacenter', 44, '云数据中心', 0.006); // 怕停电
      g.addLoad(9, 15, 'petrochem', 60, '石化基地', 0.0025); // 可中断
      g.addLoad(40, 4, 'mining', 50, '远郊矿区', 0.003); // 长线远供 → 易欠压
      const coal = g.addPlant('coal', 6, 6).bus;
      const gas = g.addPlant('gas', 8, 4).bus; // 黑启动种子
      const sub = g.addSubstation(13, 9, '主变电站');
      g.addLine(coal.id, sub.id);
      g.addLine(gas.id, sub.id);
      sim.log('info', '【能源大客户】服务数据中心/矿区/石化——备可靠电源、无功补偿与黑启动种子。');
    },
  },
  {
    id: 'market',
    name: '⑦ 商海争锋',
    brief: '强敌环伺的竞争市场：已签下数据中心/石化/轨交大客户，对手虎视眈眈。保供留客、做大市占、抓住机会反挖对手，撑过 16 天且可靠性≥90%。',
    hint: '保供差大客户会被对手挖走且对手增强；做大装机降低市场激烈度；用长约/自备应急锁客；留意品类面板的反向挖角机会削弱对手。',
    goals: '高星级=高可靠(护住大客户) + 盈利 + 清洁 + 口碑；做大市占抑制对手挖角',
    setup(sim) {
      sim.money = 1_750_000;
      sim.goalDay = 16;
      sim.goalReliability = 0.9;
      for (const c of sim.competitors) { c.base *= 1.5; c.capacity = c.base; } // 强敌：对手更强
      const g = sim.grid;
      g.addLoad(15, 6, 'commercial', 24, '商务区', 0.004);
      g.addLoad(17, 12, 'datacenter', 46, '云数据中心', 0.006);
      g.addLoad(9, 15, 'petrochem', 64, '石化基地', 0.0025);
      g.addLoad(22, 9, 'transport', 38, '轨交枢纽', 0.005);
      const coal = g.addPlant('coal', 6, 6).bus;
      const gas = g.addPlant('gas', 8, 4).bus;
      const sub = g.addSubstation(13, 9, '主变电站');
      g.addLine(coal.id, sub.id);
      g.addLine(gas.id, sub.id);
      sim.log('info', '【商海争锋】强敌环伺——保供留客、做大市占、反挖对手，撑到第 16 天。');
    },
  },
  {
    id: 'fullyear',
    name: '⑧ 周年大考',
    brief: '完整经历春夏秋冬一整年（24 天）：盛夏制冷峰、深冬采暖峰与气价飙升、季节检修窗口、丰枯来水轮替。撑过一整年且可靠性≥90%。',
    hint: '看「季节」与「预报」排兵布阵：换季淡季检修、迎峰前补容量、冬季少靠水电与燃气、夏季多晒光伏。',
    goals: '高星级 = 跨全年四季的稳定可靠 + 盈利 + 清洁 + 口碑（长周期经营的试金石）',
    setup(sim) {
      sim.money = 1_600_000;
      sim.goalDay = 24; // 一整年
      sim.goalReliability = 0.9;
      const g = sim.grid;
      g.addLoad(15, 5, 'residential', 30, '城北居民', 0.0035);
      g.addLoad(19, 12, 'commercial', 26, '中央商务区', 0.004);
      g.addLoad(8, 13, 'industrial', 34, '工业走廊', 0.003);
      g.addLoad(24, 8, 'residential', 22, '城东新区', 0.004);
      const coal = g.addPlant('coal', 5, 6).bus;
      const gas = g.addPlant('gas', 7, 4).bus;
      const sub = g.addSubstation(12, 9, '主变电站');
      g.addLine(coal.id, sub.id);
      g.addLine(gas.id, sub.id);
      sim.log('info', '【周年大考】完整一年四季——盛夏与深冬是两道大关，提前看预报与迎峰预警。');
    },
  },
  {
    id: 'restore',
    name: '⑨ 残局修复',
    brief: '你接手了一家烂摊子电力公司：两条线路停运、主力机组临修、全机队老化严重。先抢修复电，再在第 8 天前补出 N-1 冗余，撑到第 10 天且可靠性≥88%。',
    hint: '开局先用「检查/重合闸」恢复跳闸线路！老机组故障率高——安排计划检修降役龄；第 8 天前必须通过 N-1 校核（顶栏按钮）。',
    goals: '附加目标：第 8 天前通过 N-1 冗余校核（到期未过=直接失败）',
    setup(sim) {
      sim.money = 720_000;
      sim.goalDay = 10;
      sim.goalReliability = 0.88;
      sim.objectives = [{ kind: 'n1ByDay', byDay: 8 }];
      const g = sim.grid;
      const res = g.addLoad(15, 5, 'residential', 28, '老城区', 0.004);
      const com = g.addLoad(18, 12, 'commercial', 24, '商业街', 0.0045);
      const ind = g.addLoad(8, 14, 'industrial', 34, '老工业区', 0.0035);
      const coal = g.addPlant('coal', 5, 6);
      const gas = g.addPlant('gas', 7, 4);
      const sub = g.addSubstation(12, 9, '残破主变');
      const l1 = g.addLine(coal.bus.id, sub.id);
      g.addLine(gas.bus.id, sub.id);
      g.addLine(sub.id, res.bus.id);
      const l2 = g.addLine(sub.id, com.bus.id);
      g.addLine(sub.id, ind.bus.id);
      // 残局：两条线路停运待重合闸、主力煤机临修 1 天、全机队高役龄（高故障率/高成本）
      l1.tripped = true;
      l2.tripped = true;
      coal.gen.age = 32;
      coal.gen.outageUntil = 20; // 开局即在检修中，约 20 小时后归队
      gas.gen.age = 26;
      sim.log('warn', '【残局修复】前任留下的电网百孔千疮——线路跳闸、机组临修、设备老化。先抢修，再补冗余。');
    },
  },
  {
    id: 'budget',
    name: '⑩ 精打细算',
    brief: '监管冻结了你的信用额度：全程禁止贷款，只有 ¥900,000 启动资金和经营现金流。每一笔投资都要回本，撑到第 14 天且可靠性≥90%。',
    hint: '没有贷款兜底：现金归零=立即破产。优先低 capex 的燃气/光伏滚动发展，建设工期内要留足运维与燃料钱。',
    goals: '禁贷款 · 高星级 = 抠出利润的同时保住可靠性',
    setup(sim) {
      sim.money = 900_000;
      sim.goalDay = 14;
      sim.goalReliability = 0.9;
      sim.loanBan = true;
      const g = sim.grid;
      g.addLoad(15, 5, 'residential', 30, '城北', 0.0045);
      g.addLoad(19, 12, 'commercial', 26, '商圈', 0.005);
      g.addLoad(8, 13, 'industrial', 34, '工业区', 0.0038);
      const coal = g.addPlant('coal', 5, 6).bus;
      const sub = g.addSubstation(12, 9, '主变电站');
      g.addLine(coal.id, sub.id);
      sim.log('info', '【精打细算】信用额度被冻结——全程无贷款，现金流就是生命线。');
    },
  },
  {
    id: 'megadeal',
    name: '⑪ 超级大单',
    brief: '一家云计算巨头宣布在本区域选址数据中心，窗口只到第 8 天——错过即出局（直接判负）。先把电网做可靠，签下大单，再撑到第 16 天且可靠性≥90%。',
    hint: '第 8 天前必须用「💻 数据中心」工具签下大客户（竞争力太低会被拒——先保口碑/可靠性）！签约后它最怕停电，备好冗余与储能。',
    goals: '附加目标：第 8 天前签下数据中心 · 高星级 = 大单收入 + 高可靠',
    setup(sim) {
      sim.money = 1_400_000;
      sim.goalDay = 16;
      sim.goalReliability = 0.9;
      sim.objectives = [{ kind: 'keyAccountByDay', profile: 'datacenter', byDay: 8 }];
      sim.nextLeadAt = 2 * 24; // 第 2 天招商窗口开启（窗口期接入费有折扣）
      // 剧本事件链：签约后的考验——第 9 天热浪、第 12 天风暴
      sim.scriptedWeather = [
        { atClock: 9 * 24 + 12, kind: 'heatwave' },
        { atClock: 12 * 24 + 6, kind: 'storm' },
      ];
      const g = sim.grid;
      g.addLoad(15, 6, 'commercial', 24, '商务区', 0.004);
      g.addLoad(9, 14, 'industrial', 30, '产业园', 0.0035);
      const coal = g.addPlant('coal', 5, 6).bus;
      const gas = g.addPlant('gas', 7, 4).bus;
      const sub = g.addSubstation(12, 9, '主变电站');
      g.addLine(coal.id, sub.id);
      g.addLine(gas.id, sub.id);
      sim.log('info', '【超级大单】云巨头第 8 天前要看到一张可靠的电网——签不下这单就出局。');
    },
  },
  {
    id: 'blackout2003',
    name: '⑫ 大停电考古 · 2003',
    brief: '复刻 2003 年北美大停电的剧本：西部电源经过载走廊向东部城市远供，一条骨干线即将被"树闪"打掉——连锁跳闸一触即发。第 6 天前补出 N-1，撑到第 10 天且可靠性≥88%。',
    hint: '历史的教训：单条走廊重载 + 一次树闪 = 5,000 万人停电。开局尽快加第二条输电走廊/就地电源；风暴会再来，第 6 天前必须通过 N-1。',
    goals: '附加目标：第 6 天前通过 N-1 校核 · 这是本游戏最"电网工程"的一关',
    setup(sim) {
      sim.money = 1_050_000;
      sim.goalDay = 10;
      sim.goalReliability = 0.88;
      sim.objectives = [{ kind: 'n1ByDay', byDay: 6 }];
      // 剧本：开局 5 小时"树闪"风暴打掉走廊（风暴会随机损毁一条在运线路）；第 4 天再来一场
      sim.scriptedWeather = [
        { atClock: 5, kind: 'storm' },
        { atClock: 4 * 24 + 10, kind: 'storm' },
      ];
      const g = sim.grid;
      // 西部电源群
      const coal1 = g.addPlant('coal', 4, 6).bus;
      const coal2 = g.addPlant('coal', 3, 10).bus;
      const gas = g.addPlant('gas', 6, 4).bus;
      const west = g.addSubstation(8, 8, '西部枢纽');
      g.addLine(coal1.id, west.id);
      g.addLine(coal2.id, west.id);
      g.addLine(gas.id, west.id);
      // 东部城市群（远离电源——只能靠输电走廊）
      const east = g.addSubstation(26, 12, '东部枢纽');
      const r = g.addLoad(29, 9, 'residential', 40, '东部市区', 0.004);
      const c = g.addLoad(31, 14, 'commercial', 34, '金融城', 0.0045);
      const i = g.addLoad(27, 17, 'industrial', 38, '制造带', 0.0035);
      g.addLine(east.id, r.bus.id);
      g.addLine(east.id, c.bus.id);
      g.addLine(east.id, i.bus.id);
      // 唯一的重载输电走廊（HV ~170MW vs 110+MW 负荷且持续增长）——这就是 2003 的"Harding-Chamberlin"
      g.addLine(west.id, east.id);
      sim.events.nextAt = sim.clock + 30; // 随机天气稍晚——前 5 小时留给剧本
      sim.log('warn', '【大停电考古】2003-08-14：一条重载骨干线擦过未修剪的树木后跳闸，连锁反应在 8 分钟内击溃了整个东北电网。这一次，轮到你来改写历史。');
    },
  },
  {
    id: 'endless',
    name: '∞ 无尽经营',
    brief: '没有终点的生涯模式：城市持续成长、四季循环、对手演化、政策更迭。唯一的失败是破产。每年给出经营年报，看你能把电力帝国带到多远。',
    hint: '无尽模式：无通关日，但会破产！稳健扩张、留足现金流，用年报检视长期经营曲线。',
    goals: '长期目标：跨年稳定 S 级 · 市占主导 · 全面清洁化 · 科技点满',
    setup(sim) {
      sim.money = 950_000;
      sim.goalDay = Infinity; // 无终点
      sim.goalReliability = 0.9;
      const g = sim.grid;
      g.addLoad(14, 4, 'residential', 26, '老城居民', 0.0045);
      g.addLoad(17, 12, 'commercial', 22, '商业街', 0.005);
      g.addLoad(7, 14, 'industrial', 32, '工业园', 0.0038);
      const coal = g.addPlant('coal', 5, 5).bus;
      const sub = g.addSubstation(10, 8, '中心变电站');
      g.addLine(coal.id, sub.id);
      sim.log('info', '【无尽经营】城市会一直成长——唯一的失败是破产。祝你基业长青。');
    },
  },
];

// —— 每日挑战：以"当天日期"为种子生成同一张图——今天所有玩家面对同一道题 ——
/** mulberry32：小巧的确定性伪随机数发生器 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 当天的日期种子（UTC，全球同一题面） */
export function dailySeed(date = new Date()): number {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/** 用种子确定性生成每日挑战的题面（导出供测试）。
 *  维度：城区布局/起步电源/开局季节/资金/目标天数 + 燃料起价/碳价/天气烈度/燃料波动率/
 *       对手强度/初始破损/特殊禁令——组合空间数万量级，一年内不重样。 */
export function setupDaily(sim: Simulation, seed: number): void {
  const rnd = mulberry32(seed);
  sim.grid.setTerrainSeed(seed); // 当日地形/资源图也由日期种子决定
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  sim.money = 850_000 + Math.floor(rnd() * 5) * 100_000;
  sim.goalDay = 12 + Math.floor(rnd() * 5); // 12~16 天
  sim.goalReliability = 0.9;
  sim.clock = Math.floor(rnd() * 24) * 24; // 随机开局季节
  sim.events.schedule(sim.clock); // 重排首场天气（避免开局补触发一串积压事件）
  const g = sim.grid;
  // 3~5 个城区：类型/位置/规模随机但当天确定
  const n = 3 + Math.floor(rnd() * 3);
  const profiles = ['residential', 'commercial', 'industrial'] as const;
  for (let i = 0; i < n; i++) {
    const p = pick([...profiles]);
    const name = `${['城东', '城南', '城西', '城北', '新区'][i % 5]}${p === 'residential' ? '居民' : p === 'commercial' ? '商圈' : '工业'}`;
    g.addLoad(8 + Math.floor(rnd() * 22), 3 + Math.floor(rnd() * 13), p, 18 + Math.floor(rnd() * 22), name, 0.003 + rnd() * 0.003);
  }
  // 起步电源：煤或气 + 中心变电站
  const starter = pick(['coal', 'gas'] as const);
  const plant = g.addPlant(starter, 4 + Math.floor(rnd() * 3), 4 + Math.floor(rnd() * 4));
  const sub = g.addSubstation(12 + Math.floor(rnd() * 6), 7 + Math.floor(rnd() * 4), '中心变电站');
  g.addLine(plant.bus.id, sub.id);
  // 当天的"风味"扰动：燃料起价 / 碳价倍率小幅随机
  sim.fuelPrice.coal = 0.8 + rnd() * 0.5;
  sim.fuelPrice.gas = 0.8 + rnd() * 0.7;
  sim.carbonPriceMult = 0.9 + rnd() * 0.8;
  // —— 扩展维度（每个都改变当天的最优解法）——
  const flavors: string[] = [];
  // ① 天气烈度：风调雨顺 ↔ 多事之秋
  const wx = pick([0.7, 1, 1, 1.4, 1.8]);
  sim.events.intensity = wx;
  sim.events.schedule(sim.clock);
  if (wx > 1.2) flavors.push(`🌪 天气烈度 ×${wx.toFixed(1)}`);
  else if (wx < 0.9) flavors.push('☀ 风调雨顺');
  // ② 燃料波动率：平稳 ↔ 动荡行情（动荡日燃料长约/套保更值钱）
  const vol = pick([0.6, 1, 1, 1.6, 2.4]);
  sim.fuelVolatilityMult = vol;
  if (vol > 1.3) flavors.push(`📈 燃料动荡 ×${vol.toFixed(1)}`);
  // ③ 政策节奏：首个政策事件来得早或晚
  sim.policy.nextAt = sim.clock + (3 + Math.floor(rnd() * 5)) * 24;
  // ④ 对手强度：弱旅 ↔ 强敌（影响市占与挖角压力）
  const compScale = 0.7 + rnd() * 0.9;
  for (const c of sim.competitors) { c.base *= compScale; c.capacity = c.base; }
  if (compScale > 1.3) flavors.push('⚔ 强敌环伺');
  else if (compScale < 0.85) flavors.push('🕊 对手孱弱');
  // ⑤ 初始破损：三成的日子接手老化机队（检修策略前置）
  if (rnd() < 0.3) {
    plant.gen.age = 22 + Math.floor(rnd() * 16);
    flavors.push('🔧 起步机组老化');
  }
  // ⑥ 特殊禁令：部分日子禁建某类电源（强制改变路线）
  const ban = rnd();
  if (ban < 0.15) { sim.bannedPlants.add('coal'); flavors.push('🚫 禁建燃煤'); }
  else if (ban < 0.25) { sim.bannedPlants.add('nuclear'); flavors.push('🚫 禁建核电'); }
  else if (ban < 0.32) { sim.loanBan = true; flavors.push('🏦 禁止贷款'); }
  const flavorNote = flavors.length ? `今日规则：${flavors.join(' · ')}。` : '';
  sim.log('info', `【每日挑战 #${seed}】今天所有玩家同一张图——${flavorNote}撑到第 ${sim.goalDay} 天、可靠性≥90%，比比谁的评级高！`);
}

SCENARIOS.push({
  id: 'daily',
  name: `📅 每日挑战`,
  brief: '以今天日期为种子生成的随机图——全球玩家同一题面。城区布局/起步电源/开局季节/燃料行情每天换新，挑战高星级通关。',
  hint: '题面每天 0 点(UTC)刷新：先看城区分布与开局季节，再定电源组合。',
  goals: '同一张图拼评级：S 级是今日满分答卷',
  setup(sim) {
    setupDaily(sim, dailySeed());
  },
});

// 新手教程：手把手学会核心操作
SCENARIOS.push({
  id: 'tutorial',
  name: '＋ 新手教程',
  brief: '手把手学会：建变电站、拉高压/中压线、开始供电。无输赢压力，适合第一次上手。',
  hint: '跟着屏幕中央的教程提示一步步操作即可。',
  setup(sim) {
    sim.sandbox = true; // 教程无输赢压力
    sim.money = 600_000;
    sim.goalDay = Infinity;
    sim.goalReliability = 1;
    sim.tech.points = 60; // 送研发点：教程最后一步教解锁科技
    const g = sim.grid;
    g.addPlant('coal', 5, 8); // 免费电厂（待连接）
    g.addLoad(16, 8, 'residential', 24, '居民区', 0); // 待接入的城区
    sim.log('info', '【新手教程】跟着上方提示一步步来。');
  },
});

// —— 进阶 mini 教程：预设残局 + 步骤引导，把后期经济子系统各教一遍（步骤见 tutorial.ts）——
SCENARIOS.push({
  id: 'tutFinance',
  name: '💼 进阶教程 · 财务融资',
  brief: '手把手学会：贷款摊平现金流、设备保险、燃料长约、还款节流。预设一张运转中的电网，无输赢压力。',
  hint: '跟着屏幕中央的步骤操作（都在 📊 财务面板里）。',
  setup(sim) {
    sim.sandbox = true;
    sim.money = 500_000;
    sim.goalDay = Infinity;
    sim.goalReliability = 1;
    const g = sim.grid;
    const coal = g.addPlant('coal', 5, 6).bus;
    const sub = g.addSubstation(11, 9, '主变电站');
    const res = g.addLoad(16, 7, 'residential', 26, '居民区', 0.002);
    g.addLine(coal.id, sub.id);
    g.addLine(sub.id, res.bus.id);
    sim.log('info', '【财务融资教程】电网已就绪——跟着提示把财务工具箱用一遍。');
  },
});
SCENARIOS.push({
  id: 'tutMarket',
  name: '🏪 进阶教程 · 市场竞争',
  brief: '手把手学会：接入批发市场、需求响应、大客户长约与自备应急——保供留客的四件套。',
  hint: '跟着屏幕中央的步骤操作（财务面板 + 左侧改造/合约工具）。',
  setup(sim) {
    sim.sandbox = true;
    sim.money = 900_000;
    sim.goalDay = Infinity;
    sim.goalReliability = 1;
    const g = sim.grid;
    const coal = g.addPlant('coal', 5, 6).bus;
    const gas = g.addPlant('gas', 7, 4).bus;
    const sub = g.addSubstation(11, 9, '主变电站');
    const dc = g.addLoad(17, 8, 'datacenter', 40, '云数据中心', 0.003);
    g.addLine(coal.id, sub.id);
    g.addLine(gas.id, sub.id);
    g.addLine(sub.id, dc.bus.id);
    sim.log('info', '【市场竞争教程】这家数据中心就是你要守住的现金牛——跟着提示学保供留客。');
  },
});
SCENARIOS.push({
  id: 'tutDerivatives',
  name: '📈 进阶教程 · 衍生品风控',
  brief: '手把手学会：远期套保、电力期权、输电权（FTR）、远期容量承诺——对冲价格风险的金融四件套。',
  hint: '跟着屏幕中央的步骤操作（都在 📊 财务面板的市场/套保区）。',
  setup(sim) {
    sim.sandbox = true;
    sim.money = 1_200_000;
    sim.goalDay = Infinity;
    sim.goalReliability = 1;
    sim.marketEnabled = true; // 预先接入市场，FTR/跨区价差可见
    const g = sim.grid;
    const gas = g.addPlant('gas', 5, 6).bus;
    const sub = g.addSubstation(11, 9, '主变电站');
    const com = g.addLoad(16, 8, 'commercial', 28, '商业区', 0.002);
    g.addLine(gas.id, sub.id);
    g.addLine(sub.id, com.bus.id);
    sim.log('info', '【衍生品风控教程】现货价天天在变——跟着提示学会四种锁定风险的工具。');
  },
});

// 沙盒：无限资金、无输赢，自由实验
SCENARIOS.push({
  id: 'sandbox',
  name: '★ 沙盒',
  brief: '无限资金、没有输赢。已放好三个城区和一座电厂，随意建造、试电源组合、研究科技、做 N-1 校核。',
  hint: '沙盒模式：无限资金、无输赢——尽情建造与实验，点 ▶ 推进时间。',
  setup(sim) {
    sim.sandbox = true;
    sim.money = 9_999_999;
    sim.goalDay = Infinity;
    sim.goalReliability = 1;
    const g = sim.grid;
    g.addLoad(14, 4, 'residential', 30, '居民区', 0.001);
    g.addLoad(18, 11, 'commercial', 24, '商业区', 0.001);
    g.addLoad(8, 14, 'industrial', 40, '工业区', 0.001);
    const coal = g.addPlant('coal', 5, 6).bus;
    const sub = g.addSubstation(11, 9, '中心变电站');
    g.addLine(coal.id, sub.id);
    sim.log('info', '【沙盒】无限资金、无输赢——自由建造与实验。');
  },
});

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
