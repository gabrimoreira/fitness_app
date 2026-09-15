import { describe, expect, it } from 'vitest';
import { EMA_DAILY_RETENTION } from '../../config/thresholds';
import { addDays, daysBetween } from '../dates';
import * as T from '../trend';
import type { WeighIn } from '../types';

function w(date: string, weightKg: number): WeighIn {
  return { id: date, date, weightKg, source: 'manual' };
}

describe('alphaForGap', () => {
  it('segue a fórmula do SPEC', () => {
    expect(T.alphaForGap(1)).toBeCloseTo(1 - 0.9, 10);
    expect(T.alphaForGap(2)).toBeCloseTo(1 - 0.81, 10);
    expect(T.alphaForGap(3)).toBeCloseTo(1 - 0.729, 10);
  });

  it('cresce com o intervalo: o salto do fim de semana pesa mais que o de 2 dias', () => {
    // É esta a razão de existir a EMA ajustada ao tempo em vez de um alpha fixo.
    expect(T.alphaForGap(3)).toBeGreaterThan(T.alphaForGap(2));
  });

  it('tende a 1 em lacunas longas: a tendência reinicia no peso novo', () => {
    // Comportamento correto para o histórico importado, que tem meses sem registro:
    // uma tendência de um ano atrás não carrega informação sobre o peso de hoje.
    expect(T.alphaForGap(365)).toBeGreaterThan(0.999999);
    expect(T.alphaForGap(365)).toBeLessThanOrEqual(1);
  });

  it('é 0 para intervalo não positivo ou inválido', () => {
    expect(T.alphaForGap(0)).toBe(0);
    expect(T.alphaForGap(-3)).toBe(0);
    expect(T.alphaForGap(Number.NaN)).toBe(0);
  });
});

describe('computeTrend', () => {
  it('devolve vazio para série vazia', () => {
    expect(T.computeTrend([])).toEqual([]);
  });

  it('começa exatamente no primeiro peso registrado', () => {
    const trend = T.computeTrend([w('2026-09-14', 85.0)]);
    expect(trend).toHaveLength(1);
    expect(trend[0]!.trendKg).toBe(85.0);
  });

  it('aplica a recorrência do SPEC passo a passo', () => {
    const series = [w('2026-09-14', 85.0), w('2026-09-16', 84.0), w('2026-09-18', 84.6)];
    const trend = T.computeTrend(series);

    const a2 = 1 - Math.pow(EMA_DAILY_RETENTION, 2);
    const t0 = 85.0;
    const t1 = t0 + a2 * (84.0 - t0);
    const t2 = t1 + a2 * (84.6 - t1);

    expect(trend[0]!.trendKg).toBeCloseTo(t0, 10);
    expect(trend[1]!.trendKg).toBeCloseTo(t1, 10);
    expect(trend[2]!.trendKg).toBeCloseTo(t2, 10);
  });

  it('pesa intervalos irregulares de forma diferente', () => {
    // Mesmos pesos, intervalos diferentes: o de 3 dias tem que chegar mais perto
    // do valor novo do que o de 2 dias.
    const gap2 = T.computeTrend([w('2026-09-14', 85.0), w('2026-09-16', 83.0)]);
    const gap3 = T.computeTrend([w('2026-09-14', 85.0), w('2026-09-17', 83.0)]);
    expect(gap3[1]!.trendKg).toBeLessThan(gap2[1]!.trendKg);
  });

  it('suaviza: uma pesagem isolada fora da curva move pouco a tendência', () => {
    // Regra central do SPEC: nenhuma conclusão pode vir de uma pesagem isolada.
    const series = [
      w('2026-09-14', 85.0), w('2026-09-16', 85.0), w('2026-09-18', 85.0),
      w('2026-09-21', 87.0), // dia de muito sódio
    ];
    const trend = T.computeTrend(series);
    const jump = trend[3]!.trendKg - trend[2]!.trendKg;
    expect(jump).toBeGreaterThan(0);
    expect(jump).toBeLessThan(0.6); // bem menos que os 2 kg brutos
  });

  it('em peso constante a tendência fica constante', () => {
    const series = ['2026-09-14', '2026-09-16', '2026-09-18', '2026-09-21'].map((d) => w(d, 80));
    for (const p of T.computeTrend(series)) expect(p.trendKg).toBeCloseTo(80, 10);
  });

  it('após lacuna longa a tendência reinicia praticamente no peso novo', () => {
    const series = [w('2020-01-06', 95.0), w('2020-01-08', 95.0), w('2026-09-14', 85.0)];
    const trend = T.computeTrend(series);
    expect(trend[2]!.trendKg).toBeCloseTo(85.0, 6);
  });

  it('ordena a entrada e mantém uma pesagem por dia, ficando com a última', () => {
    const series = [w('2026-09-18', 84.6), w('2026-09-14', 85.0), w('2026-09-14', 86.0)];
    const trend = T.computeTrend(series);
    expect(trend.map((p) => p.date)).toEqual(['2026-09-14', '2026-09-18']);
    expect(trend[0]!.weightKg).toBe(86.0);
  });

  it('não muta o array recebido', () => {
    const series = [w('2026-09-18', 84.6), w('2026-09-14', 85.0)];
    const copy = [...series];
    T.computeTrend(series);
    expect(series).toEqual(copy);
  });
});

/** Série sintética: dias seg/qua/sex, tudo em 80 kg, com a segunda elevada em +1.0. */
function mondaySpikeSeries(n: number, mondayExtra = 1.0): WeighIn[] {
  const series: WeighIn[] = [];
  let date = '2026-06-01'; // uma segunda-feira
  const gaps = [2, 2, 3]; // seg->qua, qua->sex, sex->seg
  for (let i = 0; i < n; i++) {
    series.push(w(date, i % 3 === 0 ? 80 + mondayExtra : 80));
    date = addDays(date, gaps[i % 3]!);
  }
  return series;
}

describe('computeDeviationBaseline', () => {
  // Na série acima 1 dia em cada 3 é segunda, então a linha de base correta fica
  // em 80.333 e os desvios verdadeiros são +0.667 na segunda e -0.333 nos outros
  // dias — somando zero ao longo da semana, como tem que ser.
  const TRUE_MONDAY_DEV = 2 / 3;

  it('recupera o desvio verdadeiro da segunda, que a fórmula causal encolhe', () => {
    const series = mondaySpikeSeries(30);
    const causal = T.computeTrend(series);
    const baseline = T.computeDeviationBaseline(series);

    const idx = 15; // uma segunda no meio da série, longe das bordas
    expect(series[idx]!.weightKg).toBe(81);

    const causalDev = causal[idx]!.weightKg - causal[idx]!.trendKg;
    const unbiasedDev = baseline[idx]!.deviationKg!;

    // A causal erra para baixo em quase 30%: é o viés que motiva este módulo.
    expect(causalDev).toBeLessThan(TRUE_MONDAY_DEV * 0.75);
    // A linha de base sem o próprio ponto acerta.
    expect(unbiasedDev).toBeCloseTo(TRUE_MONDAY_DEV, 2);
  });

  it('os desvios de seg, qua e sex somam zero', () => {
    const baseline = T.computeDeviationBaseline(mondaySpikeSeries(30));
    const middle = baseline.slice(6, 24); // descarta as bordas
    const sum = middle.reduce((acc, p) => acc + (p.deviationKg ?? 0), 0);
    expect(sum / middle.length).toBeCloseTo(0, 2);
  });

  it('escala junto com o tamanho real do efeito', () => {
    const small = T.computeDeviationBaseline(mondaySpikeSeries(30, 0.4));
    const large = T.computeDeviationBaseline(mondaySpikeSeries(30, 1.6));
    expect(small[15]!.deviationKg!).toBeCloseTo(0.4 * (2 / 3), 2);
    expect(large[15]!.deviationKg!).toBeCloseTo(1.6 * (2 / 3), 2);
  });

  it('não tem atraso: numa descida linear a base cai sobre os pontos', () => {
    const series: WeighIn[] = [];
    let date = '2026-01-05';
    for (let i = 0; i < 40; i++) {
      series.push(w(date, 90 - i * 0.1));
      date = addDays(date, 2);
    }
    const causal = T.computeTrend(series);
    const baseline = T.computeDeviationBaseline(series);
    const idx = 20;

    // A EMA causal fica sistematicamente ACIMA do peso numa descida: é o atraso.
    expect(causal[idx]!.trendKg).toBeGreaterThan(causal[idx]!.weightKg + 0.05);
    // A base sem viés praticamente coincide com o peso, sem desvio espúrio.
    expect(Math.abs(baseline[idx]!.deviationKg!)).toBeLessThan(0.01);
  });

  it('o viés residual numa tendência em queda fica abaixo da resolução da balança', () => {
    // Fixa a afirmação do docstring. Série seg/qua/sex sem nenhum efeito de dia da
    // semana, caindo a ~0.5%/semana: todo desvio medido aqui é artefato da leve
    // assimetria temporal da janela, e tem que ser pequeno o bastante para não
    // inventar um efeito de fim de semana que não existe.
    const series: WeighIn[] = [];
    let date = '2026-06-01';
    const gaps = [2, 2, 3];
    for (let i = 0; i < 36; i++) {
      const dayIndex = date === '2026-06-01' ? 0 : daysBetween('2026-06-01', date);
      series.push(w(date, 85 - dayIndex * (85 * 0.005) / 7));
      date = addDays(date, gaps[i % 3]!);
    }
    const baseline = T.computeDeviationBaseline(series);
    for (const p of baseline.slice(3, 33)) {
      expect(Math.abs(p.deviationKg!)).toBeLessThan(0.03);
    }
  });

  it('em peso constante o desvio é zero', () => {
    const series = ['2026-09-14', '2026-09-16', '2026-09-18', '2026-09-21'].map((d) => w(d, 80));
    for (const p of T.computeDeviationBaseline(series)) {
      expect(p.deviationKg!).toBeCloseTo(0, 10);
    }
  });

  it('recusa estimar nas pontas da série, onde a janela fica truncada', () => {
    const series = [w('2026-09-14', 85), w('2026-09-16', 84), w('2026-09-18', 83)];
    const baseline = T.computeDeviationBaseline(series);
    // Sem cobertura dos dois lados a base seria enviesada: melhor não estimar.
    expect(baseline[0]!.baselineKg).toBeNull();
    expect(baseline[2]!.baselineKg).toBeNull();
  });

  it('lida com séries de 0 e 1 elemento', () => {
    expect(T.computeDeviationBaseline([])).toEqual([]);
    const one = T.computeDeviationBaseline([w('2026-09-14', 85)]);
    expect(one).toHaveLength(1);
    // Um ponto sozinho não tem linha de base: desvio é desconhecido, não zero.
    expect(one[0]!.baselineKg).toBeNull();
    expect(one[0]!.deviationKg).toBeNull();
  });
});

describe('consultas sobre a tendência', () => {
  const series = [w('2026-09-14', 85.0), w('2026-09-16', 84.0), w('2026-09-18', 83.0)];
  const trend = T.computeTrend(series);

  it('trendAsOf usa a última pesagem até a data, inclusive', () => {
    expect(T.trendAsOf(trend, '2026-09-13')).toBeNull();
    expect(T.trendAsOf(trend, '2026-09-14')).toBeCloseTo(85.0, 10);
    expect(T.trendAsOf(trend, '2026-09-15')).toBeCloseTo(85.0, 10); // dia sem pesagem
    expect(T.trendAsOf(trend, '2026-09-30')).toBeCloseTo(trend[2]!.trendKg, 10);
  });

  it('lastTrendPointInRange respeita os dois limites', () => {
    expect(T.lastTrendPointInRange(trend, '2026-09-14', '2026-09-16')!.date).toBe('2026-09-16');
    expect(T.lastTrendPointInRange(trend, '2026-09-19', '2026-09-30')).toBeNull();
  });

  it('trendLow acha o menor valor da tendência', () => {
    expect(T.trendLow(trend)!.date).toBe('2026-09-18');
    expect(T.trendLow([])).toBeNull();
  });
});
