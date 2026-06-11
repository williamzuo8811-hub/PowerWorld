// 程序化新闻系统：每天根据游戏状态生成 1~2 条《电力世界日报》头条，
// 把"冷冰冰的数值"翻译成"活的城市"——并与口碑/市场状态形成可感知的因果。
// 对手人物化：每家公司有 CEO 人设，重大动作时会"对媒体放话"。
import type { Simulation } from '../sim/simulation';

/** 对手公司的人物设定（名字与 COMPETITORS_INIT 对应；按 style 兜底） */
const CEO_PERSONA: Record<string, { ceo: string; tone: string }> = {
  绿源电力: { ceo: '林清源', tone: '理想主义的清洁能源布道者' },
  蓝煤集团: { ceo: '霍铁山', tone: '老派强硬的火电大亨' },
  峰谷能源: { ceo: '邵锐', tone: '嗜血的价格战操盘手' },
};

interface NewsState {
  lastDay: number;
  saidKeys: Set<string>; // 已发过的"一次性"头条（里程碑类只报一次）
  lastSeason: string;
  prevCompetitorCount: number;
  prevDemand: number;
}

export class NewsSystem {
  private st: NewsState = { lastDay: -1, saidKeys: new Set(), lastSeason: '', prevCompetitorCount: -1, prevDemand: 0 };

  reset(): void {
    this.st = { lastDay: -1, saidKeys: new Set(), lastSeason: '', prevCompetitorCount: -1, prevDemand: 0 };
  }

  /** 每帧调用：跨天时生成当日头条（写入事件日志，📰 前缀） */
  update(sim: Simulation): void {
    if (sim.gameOver) return;
    if (this.st.prevCompetitorCount < 0) this.st.prevCompetitorCount = sim.competitors.length;
    // 对手消失（被并购/退场）的市场评论——即时触发
    if (sim.competitors.length < this.st.prevCompetitorCount) {
      this.st.prevCompetitorCount = sim.competitors.length;
      sim.log('info', '📰 市场震动：区域发电格局重新洗牌，分析师称"集中度上升将引来监管目光"。');
    } else {
      this.st.prevCompetitorCount = sim.competitors.length;
    }
    if (sim.day === this.st.lastDay) return;
    this.st.lastDay = sim.day;
    if (sim.day === 0) { this.st.prevDemand = sim.totalDemand; return; } // 开局首日不发报

    const picks = this.collect(sim);
    // 每天最多 2 条，避免刷屏
    for (const n of picks.slice(0, 2)) sim.log('info', `📰 ${n}`);

    // 季度（换季）城市发展报告
    if (sim.seasonLabel !== this.st.lastSeason) {
      if (this.st.lastSeason !== '') {
        const growth = this.st.prevDemand > 1 ? ((sim.totalDemand / this.st.prevDemand - 1) * 100) : 0;
        sim.log('info', `🏙 《城市发展季报》${sim.seasonLabel}季号：用电需求较上季 ${growth >= 0 ? '+' : ''}${growth.toFixed(0)}% · 市民满意度 ${sim.reputation.toFixed(0)} 分 · 清洁电力 ${(sim.renewableShare * 100).toFixed(0)}% · 区域市占 ${(sim.marketShare * 100).toFixed(0)}%`);
      }
      this.st.lastSeason = sim.seasonLabel;
      this.st.prevDemand = sim.totalDemand;
    }
  }

  /** 候选头条（按戏剧性排序：危机 > 对手动作 > 里程碑 > 日常） */
  private collect(sim: Simulation): string[] {
    const out: string[] = [];
    const once = (key: string, text: string) => {
      if (!this.st.saidKeys.has(key)) {
        this.st.saidKeys.add(key);
        out.push(text);
      }
    };

    // —— 危机/压力类（可重复出现）——
    if (sim.reliability < 0.85) {
      out.push('《电力世界日报》头版：连环停电激怒市民，市政厅外出现"还我灯火"的抗议标语。');
    } else if (sim.spotPrice > 150) {
      out.push(`电价飙至 ¥${sim.spotPrice.toFixed(0)}/MWh，工商业用户叫苦：「电费比房租还贵」。`);
    } else if (sim.reserveMargin < 1.05 && sim.totalDemand > 10) {
      out.push('调度中心内部人士透露备用容量已逼近红线，专家呼吁尽快补充电源。');
    }

    // —— 对手人物化动作（基于公开状态推断）——
    for (const c of sim.competitors) {
      const p = CEO_PERSONA[c.name];
      if (!p) continue;
      if (c.style === 'peaker' && c.marginalCost < c.mcBase * 0.85) {
        once(`war-${c.name}`, `「${c.name}」CEO ${p.ceo} 接受采访：「价格战？我们只是把利润让给用户。」——${p.tone}的微笑背后，刀光剑影。`);
      }
      if (c.capacity > c.base * 1.8) {
        once(`expand-${c.name}`, `「${c.name}」宣布新一轮装机扩张，${p.ceo} 放话：「这片电网，迟早姓${p.ceo[0]}。」`);
      }
      if (c.capacity < c.base * 0.45) {
        once(`shrink-${c.name}`, `传「${c.name}」连续亏损、机组提前退役，${p.ceo} 拒绝回应裁员传闻。`);
      }
    }

    // —— 里程碑类（一次性）——
    if (sim.renewableShare >= 0.5) once('green50', '本市清洁电力占比突破 50%！环保组织在市中心广场放飞了 500 只纸风筝庆祝。');
    if (sim.renewableShare >= 0.9) once('green90', '《能源观察》：本市电网清洁占比达 90%，登上全国绿色转型榜首。');
    if (sim.marketShare >= 0.5) once('share50', '反垄断学者撰文提醒：单一公司市占过半，"灯火不该只有一个开关"。');
    if (sim.reputation >= 90) once('rep90', '民调：九成市民给电力公司点赞，「停电」正在变成历史词汇。');
    if (sim.reputation < 35) once('repLow', '社论：《一家不被信任的电力公司，正在透支这座城市的耐心》。');
    if (sim.peakServed >= 200) once('peak200', `本市用电负荷历史性突破 ${Math.floor(sim.peakServed / 100) * 100}MW，经济活力可见一斑。`);
    if (sim.tech.unlocked.size >= 5) once('tech5', '电力公司研究院晒出专利墙：五项核心技术落地，工程师团队登上本地热搜。');

    // —— 日常天气/季节小报（低优先级，填充版面）——
    if (out.length === 0) {
      const season = sim.seasonLabel;
      const fillers: Record<string, string> = {
        春: '春日检修季：电网工人在塔架间忙碌，「换季体检」正当时。',
        夏: '气象台提示盛夏用电高峰将至，空调负荷或创新高。',
        秋: '秋高气爽，电网负荷平稳——调度员说这是一年里最好睡的季节。',
        冬: '寒潮经济学：取暖负荷推高晚峰，燃气价格被气象预报牵着走。',
      };
      const f = fillers[season];
      if (f && Math.random() < 0.5) out.push(f);
    }
    return out;
  }
}
