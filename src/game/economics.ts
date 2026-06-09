// 投资回报估算：把"工期 / capex / 燃料 / 运维 / 容量系数"折算成可比较的
// 度电成本(LCOE)、日均毛利与回本周期。纯函数，便于测试与在面板中展示。
// 说明：这是"理想满发（按代表容量系数）"的估算，未计新能源间歇/弃风，仅供决策参考。
import { PLANTS, LCOE_LIFETIME_DAYS, TARIFF, PLANT_FUEL, type FuelType } from '../config/components';
import type { PlantType } from '../sim/types';

export interface GenEconomics {
  type: PlantType;
  label: string;
  capacity: number; // MW
  buildDays: number; // 工期（天）
  capex: number;
  fuel: number; // 燃料 ¥/MWh
  omPerDay: number; // 运维 ¥/天
  cf: number; // 代表容量系数
  energyPerDay: number; // 估算日发电量 MWh
  lcoe: number; // 度电成本 ¥/MWh
  dailyProfit: number; // 日均毛利 ¥（收入−燃料−运维，不含 capex）
  paybackDays: number; // 回本周期（含工期），无法回本为 Infinity
  co2: number;
}

export function genEconomics(
  tariff: number = TARIFF,
  fuelPrice: Record<FuelType, number> = { coal: 1, gas: 1, uranium: 1 },
): GenEconomics[] {
  return Object.values(PLANTS).map((spec) => {
    const fuelType = PLANT_FUEL[spec.type];
    const effFuel = spec.marginalCost * (fuelType ? fuelPrice[fuelType] : 1); // 含燃料价格指数
    const energyPerDay = spec.capacity * spec.cf * 24; // MWh/day
    const fuelPerDay = energyPerDay * effFuel;
    const capexPerDay = spec.capex / LCOE_LIFETIME_DAYS;
    const lcoe = (capexPerDay + fuelPerDay + spec.omPerDay) / Math.max(energyPerDay, 1);
    const dailyProfit = energyPerDay * tariff - fuelPerDay - spec.omPerDay;
    const paybackDays = dailyProfit > 0 ? spec.buildDays + spec.capex / dailyProfit : Infinity;
    return {
      type: spec.type, label: spec.label, capacity: spec.capacity, buildDays: spec.buildDays,
      capex: spec.capex, fuel: effFuel, omPerDay: spec.omPerDay, cf: spec.cf,
      energyPerDay, lcoe, dailyProfit, paybackDays, co2: spec.co2,
    };
  });
}
