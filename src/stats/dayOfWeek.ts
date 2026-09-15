/**
 * Desvio médio por dia da semana e rebote de fim de semana.
 *
 * Responde "qual o efeito do meu fim de semana?" (gráfico 4). São as duas medidas
 * que dão contexto ao feedback de segunda-feira: um rebote de +0,4 kg só significa
 * alguma coisa comparado com a média histórica de rebote do próprio usuário.
 */

import {
  DAY_OF_WEEK_WINDOW_WEEKS,
  REBOUND_EXPECTED_GAP_DAYS,
  REBOUND_MOVING_AVERAGE_COUNT,
} from '../config/thresholds';
import { addDays, dayOfWeek, daysBetween, weekdayShortFromIndex } from './dates';
import { computeDeviationBaseline, dedupeByDate } from './trend';
import type { WeighIn } from './types';

export interface DayDeviation {
  /** 0=domingo .. 6=sábado. */
  dayOfWeek: number;
  label: string;
  /** Desvio médio em kg. Positivo = mais pesado que a linha de base da semana. */
  meanDeviationKg: number;
  /** Quantas pesagens entraram na média. */
  n: number;
}

/**
 * Desvio médio de cada dia da semana em relação à linha de base local.
 *
 * Usa `computeDeviationBaseline`, e não a tendência causal do SPEC: a tendência
 * causal já absorveu o peso do próprio dia e encolhe o desvio em cerca de 30%.
 * A explicação completa, com os números medidos, está no docstring daquela função.
 *
 * A linha de base é calculada sobre a SÉRIE INTEIRA e só depois filtrada pela
 * janela. Fazer o contrário truncaria a janela de uma semana nas bordas do
 * recorte e jogaria fora as pesagens das pontas.
 */
export function deviationByDayOfWeek(
  weighIns: readonly WeighIn[],
  asOfDate: string,
  windowWeeks: number = DAY_OF_WEEK_WINDOW_WEEKS,
): DayDeviation[] {
  const baseline = computeDeviationBaseline(weighIns);
  const from = addDays(asOfDate, -windowWeeks * 7);

  const sums = new Map<number, { sum: number; n: number }>();
  for (const point of baseline) {
    if (point.deviationKg === null) continue;
    if (point.date < from || point.date > asOfDate) continue;
    const dow = dayOfWeek(point.date);
    const bucket = sums.get(dow) ?? { sum: 0, n: 0 };
    bucket.sum += point.deviationKg;
    bucket.n += 1;
    sums.set(dow, bucket);
  }

  return [...sums.entries()]
    .map(([dow, { sum, n }]) => ({
      dayOfWeek: dow,
      label: weekdayShortFromIndex(dow),
      meanDeviationKg: sum / n,
      n,
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

export interface Rebound {
  fridayDate: string;
  mondayDate: string;
  fridayKg: number;
  mondayKg: number;
  /** Segunda menos sexta. Positivo = ganhou peso no fim de semana. */
  deltaKg: number;
}

/**
 * Rebote de fim de semana: cada par sexta -> segunda seguinte.
 *
 * Só forma par quando as duas pontas existem e estão exatamente a
 * `REBOUND_EXPECTED_GAP_DAYS` dias de distância. Um par com intervalo diferente
 * (feriado, pesagem de sábado vinda do histórico importado) mediria uma janela de
 * outro tamanho e não é comparável com os demais — misturá-los distorceria a média
 * histórica, que é justamente a régua do feedback de segunda-feira.
 */
export function weekendRebounds(weighIns: readonly WeighIn[]): Rebound[] {
  const series = dedupeByDate(weighIns);
  const byDate = new Map(series.map((w) => [w.date, w]));
  const out: Rebound[] = [];

  for (const friday of series) {
    if (dayOfWeek(friday.date) !== 5) continue;
    const mondayDate = addDays(friday.date, REBOUND_EXPECTED_GAP_DAYS);
    const monday = byDate.get(mondayDate);
    if (!monday) continue;
    out.push({
      fridayDate: friday.date,
      mondayDate,
      fridayKg: friday.weightKg,
      mondayKg: monday.weightKg,
      deltaKg: monday.weightKg - friday.weightKg,
    });
  }

  return out;
}

/** Média das últimas `count` ocorrências de rebote. Nulo se não houver nenhuma. */
export function reboundAverage(
  rebounds: readonly Rebound[],
  count: number = REBOUND_MOVING_AVERAGE_COUNT,
): number | null {
  if (rebounds.length === 0) return null;
  const recent = rebounds.slice(-count);
  return recent.reduce((s, r) => s + r.deltaKg, 0) / recent.length;
}

/**
 * Série da média móvel do rebote, um ponto por ocorrência (gráfico 4).
 * Cada ponto é a média das até `count` ocorrências até ali, inclusive.
 */
export function reboundMovingAverage(
  rebounds: readonly Rebound[],
  count: number = REBOUND_MOVING_AVERAGE_COUNT,
): { date: string; deltaKg: number; movingAverageKg: number }[] {
  return rebounds.map((r, i) => {
    const window = rebounds.slice(Math.max(0, i - count + 1), i + 1);
    return {
      date: r.mondayDate,
      deltaKg: r.deltaKg,
      movingAverageKg: window.reduce((s, x) => s + x.deltaKg, 0) / window.length,
    };
  });
}

/**
 * O rebote mais recente comparado com a média das ocorrências ANTERIORES a ele.
 *
 * A comparação exclui a própria ocorrência de propósito: incluí-la na régua faria
 * o rebote de hoje puxar a média com que ele mesmo é comparado, amortecendo a
 * leitura — e a frase do feedback é literalmente "este fim de semana contra o seu
 * histórico".
 */
export function latestReboundInContext(
  weighIns: readonly WeighIn[],
  asOfDate: string,
  count: number = REBOUND_MOVING_AVERAGE_COUNT,
): { current: Rebound; historicalAverageKg: number | null; n: number } | null {
  const rebounds = weekendRebounds(weighIns).filter((r) => r.mondayDate <= asOfDate);
  const current = rebounds[rebounds.length - 1];
  if (!current) return null;

  const previous = rebounds.slice(0, -1).slice(-count);
  return {
    current,
    historicalAverageKg:
      previous.length > 0
        ? previous.reduce((s, r) => s + r.deltaKg, 0) / previous.length
        : null,
    n: previous.length,
  };
}

/**
 * Pesagem do mesmo dia da semana na semana anterior.
 *
 * É a comparação que o SPEC pede no feedback (segunda contra segunda), em vez de
 * contra a pesagem imediatamente anterior: comparar uma segunda com a sexta
 * anterior mede o fim de semana, não o progresso.
 */
export function sameDayLastWeek(
  weighIns: readonly WeighIn[],
  date: string,
): WeighIn | null {
  const target = addDays(date, -7);
  return dedupeByDate(weighIns).find((w) => w.date === target) ?? null;
}

/** Dias desde a pesagem anterior a `date`, ou nulo se for a primeira. */
export function daysSincePreviousWeighIn(
  weighIns: readonly WeighIn[],
  date: string,
): number | null {
  const series = dedupeByDate(weighIns).filter((w) => w.date < date);
  const previous = series[series.length - 1];
  return previous ? daysBetween(previous.date, date) : null;
}
