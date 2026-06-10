// 研发状态：已解锁科技集合 + 研发点，并把科技效果暴露为一组只读修正系数。
import { type TechId, TECHS, TECH_FX } from '../config/tech';
import type { VoltageClass } from './types';

export class TechState {
  unlocked = new Set<TechId>();
  points = 0;

  has(id: TechId): boolean {
    return this.unlocked.has(id);
  }

  /** 前置科技是否全部满足（决定能否研发） */
  canUnlock(id: TechId): boolean {
    const spec = TECHS.find((t) => t.id === id);
    if (!spec) return false;
    return (spec.requires ?? []).every((r) => this.unlocked.has(r));
  }

  // —— 输电 ——
  get hvLossFactor(): number {
    let f = this.has('ehv') ? TECH_FX.hvLossFactor : 1;
    if (this.has('hvdc')) f *= TECH_FX.hvdcLossFactor;
    return f;
  }
  /** 线路有效热极限系数（按电压等级） */
  lineCapacityFactor(voltage: VoltageClass): number {
    let f = this.has('dlr') ? TECH_FX.dlrCapacityFactor : 1;
    if (voltage === 'HV' && this.has('hvdc')) f *= TECH_FX.hvdcCapacityFactor;
    return f;
  }
  get transformerRatingFactor(): number {
    return this.has('bigTransformer') ? TECH_FX.transformerRatingFactor : 1;
  }

  // —— 发电 ——
  get fuelCostFactor(): number {
    return this.has('efficient') ? TECH_FX.fuelCostFactor : 1;
  }
  get co2Factor(): number {
    return this.has('efficient') ? TECH_FX.co2Factor : 1;
  }
  get gasCostFactor(): number {
    return this.has('combinedCycle') ? TECH_FX.gasCostFactor : 1;
  }
  get coalPminFactor(): number {
    return this.has('flexCoal') ? TECH_FX.coalPminFactor : 1;
  }
  get coalRampFactor(): number {
    return this.has('flexCoal') ? TECH_FX.coalRampFactor : 1;
  }
  /** CCS 能耗惩罚系数（基础值由调用方传入，新一代 CCS 替换为更优值） */
  ccsCostFactor(base: number): number {
    return this.has('ccsAdv') ? TECH_FX.ccsAdvCostFactor : base;
  }
  ccsCaptureRate(base: number): number {
    return this.has('ccsAdv') ? TECH_FX.ccsAdvCaptureRate : base;
  }

  // —— 储能 ——
  get batteryPowerFactor(): number {
    return this.has('advStorage') ? TECH_FX.batteryPowerFactor : 1;
  }
  get batteryRoundTripBonus(): number {
    return this.has('advStorage') ? TECH_FX.batteryRoundTripBonus : 0;
  }
  get storageQFactor(): number {
    return this.has('gridForming') ? TECH_FX.storageQFactor : 1;
  }
  get storageCreditFactor(): number {
    return this.has('gridForming') ? TECH_FX.storageCreditFactor : 1;
  }
  get storageEnergyFactor(): number {
    return this.has('longDuration') ? TECH_FX.storageEnergyFactor : 1;
  }

  // —— 智能电网 ——
  get demandFactor(): number {
    return this.has('demandResponse') ? TECH_FX.demandFactor : 1;
  }
  get reserveKFactor(): number {
    return this.has('forecasting') ? TECH_FX.forecastReserveK : 1;
  }
  get renewAvailFactor(): number {
    return this.has('forecasting') ? TECH_FX.forecastRenewFactor : 1;
  }
  get drFractionFactor(): number {
    return this.has('vpp') ? TECH_FX.vppDrFractionFactor : 1;
  }
  get drIncentiveFactor(): number {
    return this.has('vpp') ? TECH_FX.vppDrIncentiveFactor : 1;
  }
  get autoReclose(): boolean {
    return this.has('autoReclose');
  }
  get autoRecloseDelay(): number {
    return this.has('selfHealing') ? TECH_FX.selfHealRecloseDelay : TECH_FX.autoRecloseDelay;
  }
  get tripDelayFactor(): number {
    return this.has('selfHealing') ? TECH_FX.selfHealTripFactor : 1;
  }

  // —— 市场经营 ——
  get hedgeFeeFactor(): number {
    return this.has('trading') ? TECH_FX.hedgeFeeFactor : 1;
  }
  get optionPremiumFactor(): number {
    return this.has('trading') ? TECH_FX.optionPremiumFactor : 1;
  }
  get insuranceFactor(): number {
    return this.has('riskMgmt') ? TECH_FX.insuranceFactor : 1;
  }
  get loanRateDiscount(): number {
    return this.has('riskMgmt') ? TECH_FX.loanRateDiscount : 0;
  }
  get recFactor(): number {
    return this.has('lobby') ? TECH_FX.recFactor : 1;
  }
  get benchmarkFactor(): number {
    return this.has('lobby') ? TECH_FX.benchmarkFactor : 1;
  }
}
