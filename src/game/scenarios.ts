// 战役关卡定义。每个关卡设定起始资金、目标、初始电网与电源布局。
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
