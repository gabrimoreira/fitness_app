import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '../dates';
import * as P from '../projection';
import { generateSeed } from '../seed';
import { computeTrend } from '../trend';
import type { WeighIn } from '../types';

function w(date: string, weightKg: number): WeighIn {
  return { id: date, date, weightKg, source: 'manual' };
}

/** Série seg/qua/sex com taxa constante e ruído opcional determinístico. */
function series(days: number, startKg: number, kgPerWeek: number, noiseKg = 0): WeighIn[] {
  const out: WeighIn[] = [];
  const gaps = [2, 2, 3];
  let date = '2026-03-02';
  let elapsed = 0;
  let i = 0;
  while (elapsed < days) {
    // Ruído determinístico em zigue-zague, para não depender de PRNG aqui.
    const noise = noiseKg * (i % 2 === 0 ? 1 : -1);
    out.push(w(date, startKg + (kgPerWeek * elapsed) / 7 + noise));
    const gap = gaps[i % 3]!;
    date = addDays(date, gap);
    elapsed += gap;
    i++;
  }
  return out;
}

function project(data: WeighIn[], goal: number | undefined, asOf?: string) {
  const trend = computeTrend(data);
  const date = asOf ?? data[data.length - 1]!.date;
  return P.projectToGoal(data, trend, goal, date);
}

describe('guardas de exibição', () => {
  it('não projeta sem meta definida', () => {
    const result = project(series(60, 90, -0.4), undefined);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('sem-meta');
  });

  it('não projeta com menos de três semanas de dados', () => {
    // Regra explícita do SPEC.
    const result = project(series(14, 90, -0.4), 80);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('historico-curto');
  });

  it('não projeta quando o ritmo não aponta para a meta', () => {
    // Ganhando peso com meta abaixo: a reta nunca chega lá.
    const result = project(series(60, 85, +0.4), 80);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('ritmo-nao-aponta-para-meta');
  });

  it('não projeta num platô, onde a data seria arbitrária', () => {
    // Inclinação indistinguível de zero daria uma data a décadas de distância,
    // e um número desses é pior do que não mostrar nada.
    const result = project(series(60, 85, 0, 0.3), 80);
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(['ritmo-indistinguivel-de-zero', 'horizonte-longo-demais']).toContain(result.reason);
    }
  });

  it('não projeta além do horizonte máximo', () => {
    // Perda real mas lentíssima: a meta fica a anos de distância.
    const result = project(series(60, 90, -0.02, 0.05), 60);
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(['horizonte-longo-demais', 'ritmo-indistinguivel-de-zero']).toContain(result.reason);
    }
  });

  it('não projeta quando a meta já foi atingida', () => {
    const data = series(60, 85, -0.4);
    const trend = computeTrend(data);
    const current = trend[trend.length - 1]!.trendKg;
    const result = project(data, current);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('meta-atingida');
  });

  it('não projeta sem pontos suficientes na janela', () => {
    const data = [w('2026-03-02', 90), w('2026-04-06', 88)];
    expect(project(data, 80).available).toBe(false);
  });
});

describe('projeção válida', () => {
  it('acerta a data numa descida limpa e constante', () => {
    // -0.42 kg/semana de 90 até 80 são 10 kg, ou ~167 dias.
    const data = series(60, 90, -0.42);
    const result = project(data, 80);
    expect(result.available).toBe(true);
    if (!result.available) return;

    const trend = computeTrend(data);
    const remaining = trend[trend.length - 1]!.trendKg - 80;
    const expectedDays = Math.round((remaining / 0.42) * 7);
    expect(result.daysToGoal).toBeGreaterThan(expectedDays * 0.9);
    expect(result.daysToGoal).toBeLessThan(expectedDays * 1.1);
  });

  it('a data estimada fica no futuro e dentro da faixa', () => {
    const data = series(60, 90, -0.42);
    const asOf = data[data.length - 1]!.date;
    const result = project(data, 80);
    if (!result.available) throw new Error('esperava projeção disponível');

    expect(result.estimatedDate > asOf).toBe(true);
    expect(result.earliestDate <= result.estimatedDate).toBe(true);
    expect(result.latestDate >= result.estimatedDate).toBe(true);
  });

  it('projeta para cima quando a meta está acima do peso atual', () => {
    const result = project(series(60, 70, +0.3), 75);
    expect(result.available).toBe(true);
    if (result.available) expect(result.kgPerWeek).toBeGreaterThan(0);
  });

  it('mais ruído nas pesagens alarga a faixa de incerteza', () => {
    // É o ponto central da decisão de derivar a faixa das pesagens brutas: a
    // incerteza tem que refletir o ruído real de água e sódio.
    const quiet = project(series(60, 90, -0.42, 0.05), 80);
    const noisy = project(series(60, 90, -0.42, 0.8), 80);
    if (!quiet.available || !noisy.available) throw new Error('esperava projeções');

    expect(noisy.residualStdDevKg).toBeGreaterThan(quiet.residualStdDevKg);

    const quietSpread = daysBetween(quiet.earliestDate, quiet.latestDate);
    const noisySpread = daysBetween(noisy.earliestDate, noisy.latestDate);
    expect(noisySpread).toBeGreaterThan(quietSpread);
  });

  it('a faixa não é absurdamente estreita, como seria usando os resíduos da tendência', () => {
    // Guarda contra a regressão mais provável deste módulo: trocar a dispersão
    // das pesagens brutas pelo erro padrão OLS sobre a tendência, que é
    // autocorrelacionada e subestima a incerteza em ~1 ordem de grandeza.
    const data = series(60, 90, -0.42, 0.4);
    const result = project(data, 80);
    if (!result.available) throw new Error('esperava projeção disponível');

    const spreadDays = daysBetween(result.earliestDate, result.latestDate);
    expect(spreadDays).toBeGreaterThan(7); // meses de projeção não cabem em ±3 dias
    expect(result.residualStdDevKg).toBeGreaterThan(0.1);
  });

  it('funciona sobre o seed sintético', () => {
    const data = generateSeed();
    const trend = computeTrend(data);
    const result = P.projectToGoal(data, trend, 80, data[data.length - 1]!.date);
    // Não afirma disponibilidade: o seed termina em fase de perda moderada, e o
    // que importa é que a função não quebre e respeite as guardas.
    if (result.available) {
      expect(result.daysToGoal).toBeGreaterThan(0);
      expect(result.daysToGoal).toBeLessThanOrEqual(730);
    }
  });
});

describe('projectionLine', () => {
  it('começa na tendência atual e termina na data estimada', () => {
    const data = series(60, 90, -0.42);
    const asOf = data[data.length - 1]!.date;
    const result = project(data, 80);
    if (!result.available) throw new Error('esperava projeção disponível');

    const line = P.projectionLine(result, asOf);
    expect(line[0]!.date).toBe(asOf);
    expect(line[0]!.trendKg).toBeCloseTo(result.currentTrendKg, 10);
    expect(line[line.length - 1]!.date).toBe(addDays(asOf, result.daysToGoal));
  });

  it('a faixa abre em leque conforme o horizonte cresce', () => {
    const data = series(60, 90, -0.42, 0.4);
    const asOf = data[data.length - 1]!.date;
    const result = project(data, 80);
    if (!result.available) throw new Error('esperava projeção disponível');

    const line = P.projectionLine(result, asOf);
    const firstSpread = line[0]!.highKg - line[0]!.lowKg;
    const lastSpread = line[line.length - 1]!.highKg - line[line.length - 1]!.lowKg;

    expect(firstSpread).toBeCloseTo(0, 6); // hoje a tendência é conhecida
    expect(lastSpread).toBeGreaterThan(firstSpread);
  });

  it('a linha central desce quando se está perdendo peso', () => {
    const data = series(60, 90, -0.42);
    const asOf = data[data.length - 1]!.date;
    const result = project(data, 80);
    if (!result.available) throw new Error('esperava projeção disponível');

    const line = P.projectionLine(result, asOf);
    expect(line[line.length - 1]!.trendKg).toBeLessThan(line[0]!.trendKg);
  });
});
