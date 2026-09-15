import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import * as R from '../rate';
import { computeTrend } from '../trend';
import type { WeighIn } from '../types';

function w(date: string, weightKg: number): WeighIn {
  return { id: date, date, weightKg, source: 'manual' };
}

/** Série seg/qua/sex descendo a uma taxa exata de kg por dia. */
function descendingSeries(start: string, days: number, startKg: number, kgPerDay: number) {
  const series: WeighIn[] = [];
  const gaps = [2, 2, 3];
  let date = start;
  let elapsed = 0;
  for (let i = 0; elapsed < days; i++) {
    series.push(w(date, startKg - kgPerDay * elapsed));
    const gap = gaps[i % 3]!;
    date = addDays(date, gap);
    elapsed += gap;
  }
  return series;
}

describe('linearRegression', () => {
  it('recupera exatamente uma reta sem ruído', () => {
    const reg = R.linearRegression([
      { x: 0, y: 10 }, { x: 1, y: 8 }, { x: 2, y: 6 }, { x: 3, y: 4 },
    ])!;
    expect(reg.slopePerDay).toBeCloseTo(-2, 10);
    expect(reg.intercept).toBeCloseTo(10, 10);
    expect(reg.r2).toBeCloseTo(1, 10);
    expect(reg.residualStdDev).toBeCloseTo(0, 10);
  });

  it('dá inclinação zero numa série plana', () => {
    const reg = R.linearRegression([
      { x: 0, y: 80 }, { x: 2, y: 80 }, { x: 4, y: 80 },
    ])!;
    expect(reg.slopePerDay).toBeCloseTo(0, 10);
  });

  it('precisa de pelo menos dois pontos', () => {
    expect(R.linearRegression([])).toBeNull();
    expect(R.linearRegression([{ x: 0, y: 80 }])).toBeNull();
  });

  it('devolve nulo quando todos os x coincidem, em vez de inclinação zero', () => {
    // Inclinação indeterminada não é o mesmo que inclinação nula: com todos os
    // pontos na mesma data não há informação nenhuma sobre a direção.
    expect(R.linearRegression([{ x: 5, y: 80 }, { x: 5, y: 82 }])).toBeNull();
  });

  it('o erro padrão cresce com a dispersão dos resíduos', () => {
    const tight = R.linearRegression([
      { x: 0, y: 10 }, { x: 1, y: 8.1 }, { x: 2, y: 5.9 }, { x: 3, y: 4 },
    ])!;
    const loose = R.linearRegression([
      { x: 0, y: 10 }, { x: 1, y: 6 }, { x: 2, y: 8 }, { x: 3, y: 4 },
    ])!;
    expect(loose.standardErrorSlope).toBeGreaterThan(tight.standardErrorSlope);
  });

  it('lida com intervalos irregulares entre os x', () => {
    const reg = R.linearRegression([
      { x: 0, y: 100 }, { x: 2, y: 98 }, { x: 7, y: 93 }, { x: 30, y: 70 },
    ])!;
    expect(reg.slopePerDay).toBeCloseTo(-1, 10);
  });
});

describe('regressOverDates', () => {
  it('mede a inclinação em dias corridos, não em número de pontos', () => {
    // Três pontos espaçados de 10 dias caindo 1 kg cada: -0.1 kg/dia, não -1.
    const reg = R.regressOverDates([
      { date: '2026-01-01', value: 90 },
      { date: '2026-01-11', value: 89 },
      { date: '2026-01-21', value: 88 },
    ])!;
    expect(reg.slopePerDay).toBeCloseTo(-0.1, 10);
    expect(reg.originDate).toBe('2026-01-01');
  });

  it('funciona com espaçamento irregular do histórico importado', () => {
    const reg = R.regressOverDates([
      { date: '2026-01-01', value: 90 },
      { date: '2026-01-03', value: 89.8 },
      { date: '2026-02-15', value: 85.5 }, // 45 dias depois: 90 - 4.5
    ])!;
    expect(reg.slopePerDay).toBeCloseTo(-0.1, 10);
  });
});

describe('trendPointsInWindow', () => {
  const trend = computeTrend(descendingSeries('2026-06-01', 60, 85, 0.07));

  it('pega só os pontos dentro da janela que termina na data dada', () => {
    const asOf = trend[trend.length - 1]!.date;
    const window = R.trendPointsInWindow(trend, asOf, 21);
    for (const p of window) {
      expect(p.date <= asOf).toBe(true);
    }
    // 21 dias de seg/qua/sex são 9 pesagens.
    expect(window.length).toBe(9);
  });

  it('ignora pontos posteriores à data de referência', () => {
    const asOf = trend[5]!.date;
    const window = R.trendPointsInWindow(trend, asOf, 21);
    expect(window.every((p) => p.date <= asOf)).toBe(true);
  });
});

describe('weeklyRate', () => {
  it('recupera a taxa real de uma descida constante', () => {
    // 0.07 kg/dia = 0.49 kg/semana.
    const series = descendingSeries('2026-06-01', 90, 85, 0.07);
    const trend = computeTrend(series);
    const asOf = trend[trend.length - 1]!.date;
    const rate = R.weeklyRate(trend, asOf)!;

    expect(rate.kgPerWeek).toBeCloseTo(-0.49, 2);
    expect(rate.kgPerWeek).toBeLessThan(0); // negativo = perda
  });

  it('converte para % do peso corporal usando a tendência no fim da janela', () => {
    const series = descendingSeries('2026-06-01', 90, 85, 0.07);
    const trend = computeTrend(series);
    const asOf = trend[trend.length - 1]!.date;
    const rate = R.weeklyRate(trend, asOf)!;

    expect(rate.pctPerWeek).toBeCloseTo((rate.kgPerWeek / rate.referenceWeightKg) * 100, 10);
    expect(rate.pctPerWeek).toBeLessThan(0);
    expect(rate.referenceWeightKg).toBeCloseTo(trend[trend.length - 1]!.trendKg, 10);
  });

  it('dá taxa positiva quando o peso sobe', () => {
    const series = descendingSeries('2026-06-01', 90, 80, -0.05); // ganhando
    const trend = computeTrend(series);
    const rate = R.weeklyRate(trend, trend[trend.length - 1]!.date)!;
    expect(rate.kgPerWeek).toBeGreaterThan(0);
    expect(rate.pctPerWeek).toBeGreaterThan(0);
  });

  it('dá taxa próxima de zero num platô', () => {
    const series = descendingSeries('2026-06-01', 90, 82, 0);
    const trend = computeTrend(series);
    const rate = R.weeklyRate(trend, trend[trend.length - 1]!.date)!;
    expect(Math.abs(rate.kgPerWeek)).toBeLessThan(0.01);
  });

  it('devolve nulo sem pontos suficientes na janela', () => {
    const trend = computeTrend([w('2026-06-01', 85), w('2026-06-03', 84.8)]);
    expect(R.weeklyRate(trend, '2026-06-03')).toBeNull();
    expect(R.weeklyRate([], '2026-06-03')).toBeNull();
  });

  it('é robusta a uma pesagem isolada muito fora da curva', () => {
    // Regra central do SPEC: nenhuma conclusão sai de uma pesagem isolada.
    const clean = descendingSeries('2026-06-01', 90, 85, 0.07);
    const spiked = clean.map((x, i) =>
      i === clean.length - 1 ? w(x.date, x.weightKg + 1.5) : x,
    );
    const asOf = clean[clean.length - 1]!.date;

    const rateClean = R.weeklyRate(computeTrend(clean), asOf)!;
    const rateSpiked = R.weeklyRate(computeTrend(spiked), asOf)!;

    // A taxa se move, mas continua indicando perda: um dia de sódio não inverte
    // a leitura de três semanas.
    expect(rateSpiked.kgPerWeek).toBeLessThan(0);
    expect(rateSpiked.kgPerWeek - rateClean.kgPerWeek).toBeLessThan(0.3);
  });

  it('acompanha uma mudança real de ritmo dentro de poucas semanas', () => {
    const first = descendingSeries('2026-06-01', 42, 85, 0.1);
    const lastDate = first[first.length - 1]!.date;
    const lastKg = first[first.length - 1]!.weightKg;
    const second = descendingSeries(addDays(lastDate, 2), 42, lastKg, 0);
    const trend = computeTrend([...first, ...second]);

    const during = R.weeklyRate(trend, lastDate)!;
    const after = R.weeklyRate(trend, second[second.length - 1]!.date)!;

    expect(during.kgPerWeek).toBeLessThan(-0.5);
    expect(Math.abs(after.kgPerWeek)).toBeLessThan(0.1);
  });
});

describe('conversões de taxa', () => {
  it('targetRateSigned transforma a magnitude guardada em taxa negativa', () => {
    expect(R.targetRateSigned(0.5)).toBe(-0.5);
    expect(R.targetRateSigned(-0.5)).toBe(-0.5); // idempotente para entrada já negativa
  });

  it('pctPerWeekToKg usa o peso corporal de referência', () => {
    expect(R.pctPerWeekToKg(-0.5, 80)).toBeCloseTo(-0.4, 10);
    expect(R.pctPerWeekToKg(0.15, 90)).toBeCloseTo(0.135, 10);
  });
});
