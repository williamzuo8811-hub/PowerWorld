import { describe, it, expect } from 'vitest';
import { Simulation } from './simulation';
import { SEASON_YEAR_DAYS, HYDRO_AVAIL_BASE, BLACKSTART_TYPES, PLANTS } from '../config/components';

function setup(clockDays: number): Simulation {
  const sim = new Simulation();
  sim.forcedOutages = false;
  sim.clock = clockDays * 24;
  const g = sim.grid;
  const hydro = g.addPlant('hydro', 0, 0).bus;
  const sub = g.addSubstation(2, 0);
  const load = g.addLoad(4, 0, 'industrial', 45, '厂', 0).bus;
  g.addLine(hydro.id, sub.id);
  g.addLine(sub.id, load.id);
  return sim;
}

describe('水电与生物质', () => {
  it('夏季丰水出力高于冬季枯水', () => {
    const summer = setup(SEASON_YEAR_DAYS * 0.25); // 盛夏
    const winter = setup(SEASON_YEAR_DAYS * 0.75); // 深冬
    for (let i = 0; i < 120; i++) { summer.tick(0.05, 600); winter.tick(0.05, 600); }
    expect(summer.hydroAvailability).toBeGreaterThan(winter.hydroAvailability);
    const sg = [...summer.grid.gens.values()][0];
    const wg = [...winter.grid.gens.values()][0];
    expect(sg.availability).toBeGreaterThan(wg.availability);
    // 冬季出力被来水约束（< 满容量）
    expect(wg.output).toBeLessThanOrEqual(wg.capacity * wg.availability + 0.01);
    expect(wg.availability).toBeLessThan(HYDRO_AVAIL_BASE);
  });

  it('水电是黑启动电源、计入清洁占比', () => {
    expect(BLACKSTART_TYPES.hydro).toBe(true);
    const sim = setup(SEASON_YEAR_DAYS * 0.25);
    for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
    expect(sim.blackStartCapable).toBe(true);
    expect(sim.renewableShare).toBeGreaterThan(0.5); // 纯水电供电 → 清洁占比高
  });

  it('生物质是清洁可调基荷', () => {
    expect(PLANTS.biomass.dispatchable).toBe(true);
    expect(PLANTS.biomass.co2).toBeLessThan(0.05);
    const sim = new Simulation();
    sim.forcedOutages = false;
    const g = sim.grid;
    const bio = g.addPlant('biomass', 0, 0).bus;
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 20, '厂', 0).bus;
    g.addLine(bio.id, sub.id);
    g.addLine(sub.id, load.id);
    for (let i = 0; i < 200; i++) sim.tick(0.05, 600);
    expect(sim.snapshot().totalServed).toBeGreaterThan(15);
    expect(sim.renewableShare).toBeGreaterThan(0.5);
  });

  it('核电也计入清洁占比（近零碳口径）', () => {
    const sim = new Simulation();
    sim.forcedOutages = false;
    const g = sim.grid;
    const nuke = g.addPlant('nuclear', 0, 0).bus;
    const sub = g.addSubstation(2, 0);
    const load = g.addLoad(4, 0, 'industrial', 100, '厂', 0).bus;
    g.addLine(nuke.id, sub.id);
    g.addLine(sub.id, load.id);
    for (let i = 0; i < 300; i++) sim.tick(0.05, 600);
    expect(sim.renewableShare).toBeGreaterThan(0.5);
  });
});
