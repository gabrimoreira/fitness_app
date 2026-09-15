import { describe, expect, it } from 'vitest';
import { classifyWeeks, outOfPlanStreak } from '../classify';
import { dayOfWeek, daysBetween, isValidDate } from '../dates';
import { deviationByDayOfWeek, weekendRebounds } from '../dayOfWeek';
import * as S from '../seed';
import { computeTrend } from '../trend';
import type { Settings } from '../types';
import { summarizeWeeks } from '../weekly';

const settings: Settings = {
  targetRatePctPerWeek: 0.5,
  noiseBandPctPerWeek: 0.15,
  scheduleDays: [1, 3, 5],
  goalWeightKg: 80,
};

describe('makeRandom', () => {
  it('é determinístico para a mesma semente', () => {
    const a = S.makeRandom(42);
    const b = S.makeRandom(42);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('sementes diferentes dão sequências diferentes', () => {
    expect(S.makeRandom(1)()).not.toBe(S.makeRandom(2)());
  });

  it('produz valores em [0, 1)', () => {
    const random = S.makeRandom(7);
    for (let i = 0; i < 500; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('generateSeed', () => {
  const data = S.generateSeed();

  it('é determinístico', () => {
    expect(S.generateSeed()).toEqual(S.generateSeed());
    expect(S.generateSeed({ seed: 1 })).not.toEqual(S.generateSeed({ seed: 2 }));
  });

  it('cobre cerca de 6 meses', () => {
    const span = daysBetween(data[0]!.date, data[data.length - 1]!.date);
    expect(span).toBeGreaterThan(150);
    expect(span).toBeLessThan(200);
  });

  it('gera pesagens suficientes para todos os gráficos', () => {
    expect(data.length).toBeGreaterThan(60);
  });

  it('todas as datas são válidas, únicas e crescentes', () => {
    const seen = new Set<string>();
    let previous = '';
    for (const point of data) {
      expect(isValidDate(point.date)).toBe(true);
      expect(seen.has(point.date)).toBe(false);
      expect(point.date > previous).toBe(true);
      seen.add(point.date);
      previous = point.date;
    }
  });

  it('só gera pesagens nos dias programados', () => {
    for (const point of data) expect([1, 3, 5]).toContain(dayOfWeek(point.date));
  });

  it('os pesos têm uma casa decimal, como a balança mostra', () => {
    for (const point of data) {
      expect(Math.round(point.weightKg * 10)).toBeCloseTo(point.weightKg * 10, 6);
    }
  });

  it('perde algumas pesagens, para exercitar semanas parciais', () => {
    const weeks = summarizeWeeks(data, [1, 3, 5], computeTrend(data));
    const partial = weeks.filter((week) => !week.isComplete);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(weeks.length / 2); // mas a maioria é completa
  });

  it('o peso cai ao longo do período', () => {
    const trend = computeTrend(data);
    expect(trend[trend.length - 1]!.trendKg).toBeLessThan(trend[0]!.trendKg);
  });

  it('tem efeito de fim de semana detectável na segunda-feira', () => {
    const devs = deviationByDayOfWeek(data, data[data.length - 1]!.date, 26);
    const monday = devs.find((d) => d.dayOfWeek === 1)!;
    const friday = devs.find((d) => d.dayOfWeek === 5)!;
    expect(monday.meanDeviationKg).toBeGreaterThan(0);
    expect(friday.meanDeviationKg).toBeLessThan(monday.meanDeviationKg);
  });

  it('produz rebotes de fim de semana positivos em média', () => {
    const rebounds = weekendRebounds(data);
    expect(rebounds.length).toBeGreaterThan(10);
    const mean = rebounds.reduce((s, r) => s + r.deltaKg, 0) / rebounds.length;
    expect(mean).toBeGreaterThan(0);
  });

  it('exercita todas as quatro faixas de classificação', () => {
    // O seed existe para conferir as telas sem importar nada: se ele não
    // produzir todas as classes, metade das cores do gráfico 2 nunca aparece.
    const classes = new Set(
      classifyWeeks(data, settings)
        .map((c) => c.klass)
        .filter((k) => k !== null),
    );
    expect(classes).toContain('boa');
    expect(classes).toContain('neutra');
    expect(classes).toContain('fora-do-plano');
    expect(classes).toContain('progresso');
  });

  it('dispara o alerta de duas semanas seguidas em algum momento', () => {
    // Sem isso o caminho mais delicado do app — o único aviso negativo —
    // ficaria sem como ser verificado na tela.
    const classifications = classifyWeeks(data, settings);
    let maxStreak = 0;
    for (let i = 1; i <= classifications.length; i++) {
      maxStreak = Math.max(maxStreak, outOfPlanStreak(classifications.slice(0, i)));
    }
    expect(maxStreak).toBeGreaterThanOrEqual(2);
  });

  it('respeita as opções de configuração', () => {
    const custom = S.generateSeed({
      startWeightKg: 70,
      scheduleDays: [2, 4],
      endDate: '2026-06-30',
      missRate: 0,
    });
    expect(custom[0]!.weightKg).toBeLessThan(75);
    for (const point of custom) expect([2, 4]).toContain(dayOfWeek(point.date));
    expect(custom[custom.length - 1]!.date <= '2026-06-30').toBe(true);
  });

  it('com missRate zero não perde nenhuma pesagem programada', () => {
    const complete = S.generateSeed({ missRate: 0 });
    const weeks = summarizeWeeks(complete, [1, 3, 5], computeTrend(complete));
    // A primeira e a última semana podem ser parciais por causa do recorte.
    for (const week of weeks.slice(1, -1)) expect(week.isComplete).toBe(true);
  });
});
