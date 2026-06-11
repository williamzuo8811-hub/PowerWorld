// 配置参数约束校验：所有平衡数值集中在 config/ 里，这里给它们立"物理/经济常识"的护栏。
// 任何调参若违反约束（如 capex≤0、pmin>capacity、效率>1），测试立即报红——比上线后发现便宜得多。
import { describe, it, expect } from 'vitest';
import {
  PLANTS, STORAGE, VOLTAGE, KEY_ACCOUNTS, TARIFF_CLASS, RELIABILITY_WEIGHT, LOAD_MACRO,
  CAPACITY_CREDIT, DR_CURTAILABILITY, COMPETITORS_INIT, FUEL_SEASON_WINTER_AMP, FUEL_INFO,
  SUBSTATION_CAPEX, SUBSTATION_RATING, CAPACITOR_CAPEX, BACKUP_CAPEX,
  FUEL_MIN, FUEL_MAX, SPOT, START_MONEY, TARIFF, UNSERVED_PENALTY,
  GRADE_W_RELIABILITY, GRADE_W_FINANCE, GRADE_W_CLEAN, GRADE_W_REPUTATION,
} from './components';
import { TECHS, TECH_FX, RP_PER_MWH } from './tech';
import { ACHIEVEMENTS } from './achievements';
import type { LoadProfile, PlantType } from '../sim/types';

describe('机组目录约束', () => {
  it('每种机组的物理/经济参数都在合理范围', () => {
    for (const [type, p] of Object.entries(PLANTS)) {
      expect(p.capacity, `${type}.capacity`).toBeGreaterThan(0);
      expect(p.pmin, `${type}.pmin`).toBeGreaterThanOrEqual(0);
      expect(p.pmin, `${type}.pmin ≤ capacity`).toBeLessThanOrEqual(p.capacity);
      expect(p.rampRate, `${type}.rampRate`).toBeGreaterThan(0);
      expect(p.marginalCost, `${type}.marginalCost`).toBeGreaterThanOrEqual(0);
      expect(p.capex, `${type}.capex`).toBeGreaterThan(0);
      expect(p.buildDays, `${type}.buildDays`).toBeGreaterThan(0);
      expect(p.omPerDay, `${type}.omPerDay`).toBeGreaterThanOrEqual(0);
      expect(p.cf, `${type}.cf`).toBeGreaterThan(0);
      expect(p.cf, `${type}.cf ≤ 1`).toBeLessThanOrEqual(1);
      expect(p.co2, `${type}.co2`).toBeGreaterThanOrEqual(0);
      expect(p.startupCost, `${type}.startupCost`).toBeGreaterThanOrEqual(0);
      expect(p.minUpHours, `${type}.minUpHours`).toBeGreaterThanOrEqual(0);
      expect(p.minDownHours, `${type}.minDownHours`).toBeGreaterThanOrEqual(0);
    }
  });

  it('不可调度机组（风/光）pmin 为 0 且无启停成本', () => {
    for (const p of Object.values(PLANTS)) {
      if (!p.dispatchable) {
        expect(p.pmin).toBe(0);
        expect(p.startupCost).toBe(0);
      }
    }
  });
});

describe('储能目录约束', () => {
  it('功率/容量/效率/容量信用在合理范围', () => {
    for (const [type, s] of Object.entries(STORAGE)) {
      expect(s.powerRating, `${type}.powerRating`).toBeGreaterThan(0);
      expect(s.energyCapacity, `${type}.energyCapacity`).toBeGreaterThan(0);
      expect(s.capex, `${type}.capex`).toBeGreaterThan(0);
      expect(s.buildDays, `${type}.buildDays`).toBeGreaterThan(0);
      expect(s.roundTrip, `${type}.roundTrip > 0`).toBeGreaterThan(0);
      expect(s.roundTrip, `${type}.roundTrip ≤ 1`).toBeLessThanOrEqual(1);
      expect(s.capacityCredit, `${type}.capacityCredit`).toBeGreaterThan(0);
      expect(s.capacityCredit, `${type}.capacityCredit ≤ 1`).toBeLessThanOrEqual(1);
    }
  });
});

describe('电网与负荷常量约束', () => {
  it('电压等级规格合理（HV 容量更大、损耗更小、更贵）', () => {
    expect(VOLTAGE.HV.defaultCapacity).toBeGreaterThan(VOLTAGE.MV.defaultCapacity);
    expect(VOLTAGE.HV.lossScale).toBeLessThan(VOLTAGE.MV.lossScale);
    expect(VOLTAGE.HV.costPerTile).toBeGreaterThan(VOLTAGE.MV.costPerTile);
    expect(SUBSTATION_CAPEX).toBeGreaterThan(0);
    expect(SUBSTATION_RATING).toBeGreaterThan(0);
    expect(CAPACITOR_CAPEX).toBeGreaterThan(0);
    expect(BACKUP_CAPEX).toBeGreaterThan(0);
  });

  it('七类负荷画像在所有按 profile 索引的表里均有定义', () => {
    const profiles: LoadProfile[] = ['residential', 'commercial', 'industrial', 'datacenter', 'transport', 'petrochem', 'mining'];
    for (const p of profiles) {
      expect(TARIFF_CLASS[p], `TARIFF_CLASS.${p}`).toBeGreaterThan(0);
      expect(RELIABILITY_WEIGHT[p], `RELIABILITY_WEIGHT.${p}`).toBeGreaterThanOrEqual(1);
      expect(LOAD_MACRO[p], `LOAD_MACRO.${p}`).toBeTruthy();
      expect(DR_CURTAILABILITY[p], `DR_CURTAILABILITY.${p}`).toBeGreaterThanOrEqual(0);
    }
    const types: PlantType[] = ['coal', 'gas', 'wind', 'solar', 'nuclear', 'hydro', 'biomass'];
    for (const t2 of types) {
      expect(CAPACITY_CREDIT[t2], `CAPACITY_CREDIT.${t2} > 0`).toBeGreaterThan(0);
      expect(CAPACITY_CREDIT[t2], `CAPACITY_CREDIT.${t2} ≤ 1`).toBeLessThanOrEqual(1);
    }
  });

  it('大客户规格合法', () => {
    for (const [key, k] of Object.entries(KEY_ACCOUNTS)) {
      expect(k.baseDemand, `${key}.baseDemand`).toBeGreaterThan(0);
      expect(k.connectionCapex, `${key}.connectionCapex`).toBeGreaterThan(0);
      expect(k.buildDays, `${key}.buildDays`).toBeGreaterThan(0);
      expect(TARIFF_CLASS[k.profile], `${key}.profile 有电价系数`).toBeGreaterThan(0);
    }
  });

  it('经济基准量正向且自洽', () => {
    expect(START_MONEY).toBeGreaterThan(0);
    expect(TARIFF).toBeGreaterThan(0);
    expect(UNSERVED_PENALTY, '停电罚款应远高于电价').toBeGreaterThan(TARIFF);
    expect(SPOT.floor).toBeGreaterThan(0);
    expect(SPOT.cap).toBeGreaterThan(SPOT.floor);
    expect(FUEL_MIN).toBeGreaterThan(0);
    expect(FUEL_MAX).toBeGreaterThan(FUEL_MIN);
    for (const f of Object.values(FUEL_INFO)) expect(f.volatility).toBeGreaterThanOrEqual(0);
    for (const amp of Object.values(FUEL_SEASON_WINTER_AMP)) expect(amp).toBeGreaterThanOrEqual(0);
    const wSum = GRADE_W_RELIABILITY + GRADE_W_FINANCE + GRADE_W_CLEAN + GRADE_W_REPUTATION;
    expect(wSum, '评分权重之和 = 1').toBeCloseTo(1, 6);
  });

  it('初始竞争对手配置合法', () => {
    expect(COMPETITORS_INIT.length).toBeGreaterThan(0);
    for (const c of COMPETITORS_INIT) {
      expect(c.capacity).toBeGreaterThan(0);
      expect(c.marginalCost).toBeGreaterThanOrEqual(0);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
});

describe('科技树约束', () => {
  it('id 唯一、成本为正、前置引用存在且无环', () => {
    const ids = new Set(TECHS.map((t2) => t2.id));
    expect(ids.size).toBe(TECHS.length);
    for (const t2 of TECHS) {
      expect(t2.cost, `${t2.id}.cost`).toBeGreaterThan(0);
      for (const r of t2.requires ?? []) expect(ids.has(r), `${t2.id} 的前置 ${r} 存在`).toBe(true);
    }
    // 无环：沿 requires 边做拓扑排序应能遍历全部节点
    const visited = new Set<string>();
    let progress = true;
    while (progress) {
      progress = false;
      for (const t2 of TECHS) {
        if (visited.has(t2.id)) continue;
        if ((t2.requires ?? []).every((r) => visited.has(r))) {
          visited.add(t2.id);
          progress = true;
        }
      }
    }
    expect(visited.size, '科技依赖图无环').toBe(TECHS.length);
  });

  it('效果系数方向正确（折扣 <1、增益 >1、研发速率为正）', () => {
    expect(RP_PER_MWH).toBeGreaterThan(0);
    expect(TECH_FX.hvLossFactor).toBeLessThan(1);
    expect(TECH_FX.fuelCostFactor).toBeLessThan(1);
    expect(TECH_FX.demandFactor).toBeLessThan(1);
    expect(TECH_FX.dlrCapacityFactor).toBeGreaterThan(1);
    expect(TECH_FX.transformerRatingFactor).toBeGreaterThan(1);
    expect(TECH_FX.batteryPowerFactor).toBeGreaterThan(1);
  });
});

describe('成就定义约束', () => {
  it('id 唯一且判定函数可对空上下文安全求值', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect(ids.size).toBe(ACHIEVEMENTS.length);
    const empty = {
      peakServed: 0, totalEnergyServed: 0, renewableShare: 0, reputation: 0, techCount: 0,
      allTech: false, won: false, n1Secure: false, grade: 'D', outageEnergyTotal: 0,
      netWorth: 0, debt: 0, marketShare: 0, day: 0, keyAccountKinds: 0,
    };
    for (const a of ACHIEVEMENTS) expect(() => a.check(empty), a.id).not.toThrow();
  });
});
