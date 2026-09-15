/**
 * Projeção da data de chegada à meta.
 *
 * É a parte mais fácil de tornar desonesta: uma reta extrapolada dá sempre uma
 * data, e uma data específica soa muito mais confiável do que é. As guardas de
 * exibição aqui valem tanto quanto a matemática.
 */

import {
  PROJECTION_CONFIDENCE_MULTIPLIER,
  PROJECTION_MAX_HORIZON_DAYS,
  PROJECTION_MIN_HISTORY_DAYS,
  PROJECTION_WINDOW_MAX_DAYS,
} from '../config/thresholds';
import { addDays, daysBetween } from './dates';
import { regressOverDates, type Regression } from './rate';
import { dedupeByDate } from './trend';
import type { TrendPoint, WeighIn } from './types';

export type ProjectionBlockReason =
  | 'sem-meta'
  | 'historico-curto'
  | 'pontos-insuficientes'
  | 'ritmo-nao-aponta-para-meta'
  | 'ritmo-indistinguivel-de-zero'
  | 'horizonte-longo-demais'
  | 'meta-atingida';

export interface Projection {
  available: true;
  /** Data central estimada de chegada à meta. */
  estimatedDate: string;
  /** Limites da faixa de incerteza. O otimista é o mais próximo. */
  earliestDate: string;
  latestDate: string;
  daysToGoal: number;
  goalWeightKg: number;
  currentTrendKg: number;
  kgPerWeek: number;
  regression: Regression;
  /** Dispersão das pesagens brutas em torno da reta, base da faixa. */
  residualStdDevKg: number;
  /**
   * Erro padrão da inclinação, em kg/dia, calculado a partir da dispersão das
   * pesagens brutas. É o que define a largura da faixa, e fica guardado para que o
   * texto da estimativa e a faixa desenhada no gráfico nunca discordem.
   */
  slopeStandardErrorPerDay: number;
  windowDays: number;
  n: number;
}

export interface ProjectionUnavailable {
  available: false;
  reason: ProjectionBlockReason;
}

export type ProjectionResult = Projection | ProjectionUnavailable;

/**
 * Projeta a data de chegada à meta a partir da tendência recente.
 *
 * A FAIXA DE INCERTEZA VEM DAS PESAGENS BRUTAS, NÃO DA TENDÊNCIA.
 *
 * A regressão roda sobre pontos de tendência, que são fortemente autocorrelacionados
 * — a EMA constrói cada um a partir do anterior. O erro padrão de mínimos quadrados
 * pressupõe resíduos independentes, e sobre uma série suavizada ele subestima a
 * incerteza em cerca de uma ordem de grandeza: daria uma faixa de poucos dias numa
 * projeção de meses, o que é uma afirmação que os dados não sustentam.
 *
 * A faixa usada aqui parte da dispersão das PESAGENS BRUTAS em torno da mesma reta.
 * Essas sim são observações independentes, e a incerteza resultante reflete o ruído
 * real de água e sódio que o usuário convive.
 */
export function projectToGoal(
  weighIns: readonly WeighIn[],
  trend: readonly TrendPoint[],
  goalWeightKg: number | undefined,
  asOfDate: string,
  windowDays: number = PROJECTION_WINDOW_MAX_DAYS,
): ProjectionResult {
  if (goalWeightKg === undefined || !Number.isFinite(goalWeightKg)) {
    return { available: false, reason: 'sem-meta' };
  }

  const history = trend.filter((p) => p.date <= asOfDate);
  const first = history[0];
  const last = history[history.length - 1];
  if (!first || !last) return { available: false, reason: 'pontos-insuficientes' };

  // Regra do SPEC: nada de projeção com menos de três semanas de dados.
  if (daysBetween(first.date, last.date) < PROJECTION_MIN_HISTORY_DAYS) {
    return { available: false, reason: 'historico-curto' };
  }

  const window = history.filter((p) => daysBetween(p.date, asOfDate) < windowDays);
  if (window.length < 4) return { available: false, reason: 'pontos-insuficientes' };

  const regression = regressOverDates(window.map((p) => ({ date: p.date, value: p.trendKg })));
  if (!regression) return { available: false, reason: 'pontos-insuficientes' };

  const currentTrendKg = last.trendKg;
  const remainingKg = goalWeightKg - currentTrendKg;

  // Já chegou: projetar uma data no passado não ajuda ninguém.
  if (Math.abs(remainingKg) < 0.05) return { available: false, reason: 'meta-atingida' };

  const slopePerDay = regression.slopePerDay;

  // Ritmo indistinguível de zero: a data seria arbitrária. O teste usa a dispersão
  // das pesagens brutas, pelo mesmo motivo que a faixa usa.
  const rawResidualSd = rawResidualStdDev(weighIns, regression, window[0]!.date, asOfDate);
  const honestSlopeError = slopeStandardError(rawResidualSd, window);
  if (Math.abs(slopePerDay) <= honestSlopeError) {
    return { available: false, reason: 'ritmo-indistinguivel-de-zero' };
  }

  // Regra do SPEC: não mostrar se a taxa não aponta para a meta.
  if (Math.sign(slopePerDay) !== Math.sign(remainingKg)) {
    return { available: false, reason: 'ritmo-nao-aponta-para-meta' };
  }

  const daysToGoal = remainingKg / slopePerDay;
  if (daysToGoal > PROJECTION_MAX_HORIZON_DAYS) {
    return { available: false, reason: 'horizonte-longo-demais' };
  }

  // Faixa: a inclinação varia dentro de +/- k erros padrão, e cada extremo dá uma
  // data. A inclinação mais íngreme chega antes.
  const margin = PROJECTION_CONFIDENCE_MULTIPLIER * honestSlopeError;
  const steeper = slopePerDay + Math.sign(slopePerDay) * margin;
  const shallower = slopePerDay - Math.sign(slopePerDay) * margin;

  const daysSteeper = remainingKg / steeper;
  const daysShallower =
    Math.sign(shallower) === Math.sign(slopePerDay) ? remainingKg / shallower : Infinity;

  return {
    available: true,
    estimatedDate: addDays(asOfDate, Math.round(daysToGoal)),
    earliestDate: addDays(asOfDate, Math.round(Math.min(daysSteeper, daysToGoal))),
    latestDate: addDays(
      asOfDate,
      Math.round(Math.min(Math.max(daysShallower, daysToGoal), PROJECTION_MAX_HORIZON_DAYS)),
    ),
    daysToGoal: Math.round(daysToGoal),
    goalWeightKg,
    currentTrendKg,
    kgPerWeek: slopePerDay * 7,
    regression,
    residualStdDevKg: rawResidualSd,
    slopeStandardErrorPerDay: honestSlopeError,
    windowDays,
    n: window.length,
  };
}

/** Dispersão das pesagens brutas em torno da reta ajustada, dentro da janela. */
function rawResidualStdDev(
  weighIns: readonly WeighIn[],
  regression: Regression,
  from: string,
  to: string,
): number {
  const inWindow = dedupeByDate(weighIns).filter((w) => w.date >= from && w.date <= to);
  if (inWindow.length < 3) return 0;

  let sse = 0;
  for (const w of inWindow) {
    const x = daysBetween(regression.originDate, w.date);
    const predicted = regression.intercept + regression.slopePerDay * x;
    sse += (w.weightKg - predicted) ** 2;
  }
  return Math.sqrt(sse / (inWindow.length - 2));
}

/** Erro padrão da inclinação a partir de uma dispersão residual honesta. */
function slopeStandardError(residualSd: number, window: readonly TrendPoint[]): number {
  if (window.length < 3 || residualSd === 0) return 0;
  const origin = window[0]!.date;
  const xs = window.map((p) => daysBetween(origin, p.date));
  const meanX = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sxx = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
  return sxx > 0 ? residualSd / Math.sqrt(sxx) : 0;
}

/** Pontos da reta projetada e da faixa de incerteza, para desenhar no gráfico 5. */
export function projectionLine(
  projection: Projection,
  asOfDate: string,
  stepDays = 7,
): { date: string; trendKg: number; lowKg: number; highKg: number }[] {
  const margin = PROJECTION_CONFIDENCE_MULTIPLIER * projection.slopeStandardErrorPerDay;
  const points: { date: string; trendKg: number; lowKg: number; highKg: number }[] = [];

  // A faixa abre em leque a partir de hoje: a incerteza sobre a INCLINAÇÃO vira
  // uma incerteza sobre o peso que cresce proporcionalmente ao horizonte.
  for (let day = 0; day <= projection.daysToGoal; day += stepDays) {
    const central = projection.currentTrendKg + projection.regression.slopePerDay * day;
    const spread = margin * day;
    points.push({
      date: addDays(asOfDate, day),
      trendKg: central,
      lowKg: central - spread,
      highKg: central + spread,
    });
  }

  // Garante que o último ponto caia exatamente na data estimada, sem depender de
  // o horizonte ser múltiplo do passo.
  const lastDay = projection.daysToGoal;
  if (points[points.length - 1]?.date !== addDays(asOfDate, lastDay)) {
    const central = projection.currentTrendKg + projection.regression.slopePerDay * lastDay;
    const spread = margin * lastDay;
    points.push({
      date: addDays(asOfDate, lastDay),
      trendKg: central,
      lowKg: central - spread,
      highKg: central + spread,
    });
  }

  return points;
}
