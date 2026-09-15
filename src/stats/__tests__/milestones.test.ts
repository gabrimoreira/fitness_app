import { describe, expect, it } from 'vitest';
import { MILESTONE_HYSTERESIS_KG } from '../../config/thresholds';
import { addDays } from '../dates';
import * as M from '../milestones';
import { computeTrend } from '../trend';
import type { WeighIn } from '../types';

/** Série que desce linearmente de `from` até `to`, pesando a cada 2 dias. */
function descend(from: number, to: number, steps = 40): WeighIn[] {
  const out: WeighIn[] = [];
  let date = '2026-03-02';
  for (let i = 0; i <= steps; i++) {
    out.push({
      id: date,
      date,
      weightKg: from + ((to - from) * i) / steps,
      source: 'manual',
    });
    date = addDays(date, 2);
  }
  return out;
}

describe('milestonesUpTo', () => {
  it('lista um marco por quilo perdido', () => {
    const list = M.milestonesUpTo(90, 87);
    const kg = list.filter((m) => m.kind === 'kg');
    expect(kg.map((m) => m.value)).toEqual([1, 2, 3]);
  });

  it('lista marcos percentuais a cada 5% do peso inicial', () => {
    const list = M.milestonesUpTo(100, 89); // 11% perdidos
    const pct = list.filter((m) => m.kind === 'pct');
    expect(pct.map((m) => m.value)).toEqual([5, 10]);
  });

  it('inclui a meta quando ela foi alcançada', () => {
    const list = M.milestonesUpTo(90, 80, 82);
    expect(list.some((m) => m.kind === 'meta')).toBe(true);
  });

  it('não inclui a meta enquanto ela não foi alcançada', () => {
    const list = M.milestonesUpTo(90, 85, 80);
    expect(list.some((m) => m.kind === 'meta')).toBe(false);
  });

  it('não lista nada sem perda e sem meta', () => {
    expect(M.milestonesUpTo(90, 90)).toEqual([]);
    expect(M.milestonesUpTo(90, 91)).toEqual([]);
  });

  it('os limiares descem junto com os patamares', () => {
    const list = M.milestonesUpTo(90, 87);
    const kg = list.filter((m) => m.kind === 'kg');
    expect(kg.find((m) => m.value === 1)!.thresholdKg).toBeCloseTo(89, 10);
    expect(kg.find((m) => m.value === 3)!.thresholdKg).toBeCloseTo(87, 10);
  });
});

describe('evaluateMilestones', () => {
  it('não devolve nada numa série vazia', () => {
    const result = M.evaluateMilestones([], []);
    expect(result.newlyReached).toEqual([]);
    expect(result.lowestTrendKg).toBeNull();
    expect(result.isNewLow).toBe(false);
  });

  it('dispara os marcos atingidos pela primeira vez', () => {
    const trend = computeTrend(descend(90, 86));
    const result = M.evaluateMilestones(trend, []);
    expect(result.newlyReached.length).toBeGreaterThan(0);
    expect(result.newlyReached.every((m) => m.kind === 'kg' || m.kind === 'pct')).toBe(true);
  });

  it('nunca recomemora um marco já comemorado', () => {
    const trend = computeTrend(descend(90, 86));
    const first = M.evaluateMilestones(trend, []);
    const second = M.evaluateMilestones(trend, first.reachedIds);
    expect(second.newlyReached).toEqual([]);
  });

  it('acumula os ids atingidos para persistência', () => {
    const trend = computeTrend(descend(90, 86));
    const result = M.evaluateMilestones(trend, ['kg-1']);
    expect(result.reachedIds).toContain('kg-1');
    expect(result.newlyReached.some((m) => m.id === 'kg-1')).toBe(false);
  });

  it('não dispara o mesmo marco de novo quando a tendência oscila em volta dele', () => {
    // Sem histerese e sem memória, uma tendência indo e voltando em torno de -1 kg
    // comemoraria o mesmo quilo repetidamente, e o aviso perderia o sentido.
    const oscillating: WeighIn[] = [];
    let date = '2026-03-02';
    for (let i = 0; i < 30; i++) {
      oscillating.push({
        id: date,
        date,
        weightKg: 89 + (i % 2 === 0 ? 0.1 : -0.1),
        source: 'manual',
      });
      date = addDays(date, 2);
    }
    const series = [{ id: 'start', date: '2026-02-28', weightKg: 90, source: 'manual' as const }, ...oscillating];

    const trend = computeTrend(series);
    let reached: string[] = [];
    let totalCelebrations = 0;
    for (let i = 3; i <= trend.length; i++) {
      const result = M.evaluateMilestones(trend.slice(0, i), reached);
      totalCelebrations += result.newlyReached.length;
      reached = result.reachedIds;
    }
    // O marco de -1 kg é comemorado no máximo uma vez.
    expect(totalCelebrations).toBeLessThanOrEqual(1);
  });

  it('a histerese tolera uma oscilação pequena acima do patamar', () => {
    const trend = computeTrend([
      { id: 'a', date: '2026-03-02', weightKg: 90, source: 'manual' },
      { id: 'b', date: '2026-03-04', weightKg: 88.9, source: 'manual' },
      { id: 'c', date: '2026-03-06', weightKg: 89.0, source: 'manual' },
    ]);
    const result = M.evaluateMilestones(trend, []);
    const oneKg = result.newlyReached.find((m) => m.id === 'kg-1');
    if (oneKg) expect(trend[trend.length - 1]!.trendKg).toBeLessThanOrEqual(89 + MILESTONE_HYSTERESIS_KG);
  });

  it('dispara o marco da meta quando ela é alcançada', () => {
    const trend = computeTrend(descend(90, 80));
    const result = M.evaluateMilestones(trend, [], 82);
    expect(result.newlyReached.some((m) => m.kind === 'meta')).toBe(true);
  });

  it('isNewLow é verdadeiro durante uma descida', () => {
    const trend = computeTrend(descend(90, 86));
    expect(M.evaluateMilestones(trend, []).isNewLow).toBe(true);
  });

  it('isNewLow é falso quando a tendência subiu depois do mínimo', () => {
    const series = [
      ...descend(90, 86, 20),
      { id: 'up1', date: '2026-04-15', weightKg: 88, source: 'manual' as const },
      { id: 'up2', date: '2026-04-17', weightKg: 88.5, source: 'manual' as const },
      { id: 'up3', date: '2026-04-19', weightKg: 89, source: 'manual' as const },
    ];
    expect(M.evaluateMilestones(computeTrend(series), []).isNewLow).toBe(false);
  });

  it('novo mínimo não é marco: numa descida constante não gera celebração por pesagem', () => {
    // Decisão de projeto. Se "novo mínimo" fosse marco, numa fase de perda
    // dispararia em quase toda pesagem (3x por semana) e a celebração viraria ruído.
    const trend = computeTrend(descend(90, 89.5, 30)); // meio quilo, nenhum patamar
    const result = M.evaluateMilestones(trend, []);
    expect(result.isNewLow).toBe(true);
    expect(result.newlyReached).toEqual([]);
  });

  it('rotula os marcos em português', () => {
    expect(M.milestoneLabel({ id: 'kg-3', kind: 'kg', value: 3, thresholdKg: 87 }))
      .toBe('3 kg a menos na tendência');
    expect(M.milestoneLabel({ id: 'pct-5', kind: 'pct', value: 5, thresholdKg: 85.5 }))
      .toBe('5% do peso inicial');
    expect(M.milestoneLabel({ id: 'meta', kind: 'meta', value: 80, thresholdKg: 80 }))
      .toBe('meta atingida');
  });
});
