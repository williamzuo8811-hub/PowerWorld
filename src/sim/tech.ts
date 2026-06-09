// 研发状态：已解锁科技集合 + 研发点，并把科技效果暴露为一组只读修正系数。
import { type TechId, TECH_FX } from '../config/tech';

export class TechState {
  unlocked = new Set<TechId>();
  points = 0;

  has(id: TechId): boolean {
    return this.unlocked.has(id);
  }

  get hvLossFactor(): number {
    return this.has('ehv') ? TECH_FX.hvLossFactor : 1;
  }
  get fuelCostFactor(): number {
    return this.has('efficient') ? TECH_FX.fuelCostFactor : 1;
  }
  get co2Factor(): number {
    return this.has('efficient') ? TECH_FX.co2Factor : 1;
  }
  get demandFactor(): number {
    return this.has('demandResponse') ? TECH_FX.demandFactor : 1;
  }
  get transformerRatingFactor(): number {
    return this.has('bigTransformer') ? TECH_FX.transformerRatingFactor : 1;
  }
  get batteryPowerFactor(): number {
    return this.has('advStorage') ? TECH_FX.batteryPowerFactor : 1;
  }
  get batteryRoundTripBonus(): number {
    return this.has('advStorage') ? TECH_FX.batteryRoundTripBonus : 0;
  }
  get autoReclose(): boolean {
    return this.has('autoReclose');
  }
}
