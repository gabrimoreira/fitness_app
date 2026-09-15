/**
 * Regressão linear e taxa de variação semanal.
 *
 * CONVENÇÃO DE SINAL: taxas são assinadas e NEGATIVO = PERDA.
 * Uma taxa de -0.5 %/semana é meio por cento do peso corporal perdido por semana.
 * A única exceção no projeto é `Settings.targetRatePctPerWeek`, guardado positivo
 * como magnitude por ser o que o usuário digita — converta com `targetRateSigned`.
 */

import { RATE_MIN_POINTS, RATE_WINDOW_DAYS } from '../config/thresholds';
import { daysBetween } from './dates';
import type { TrendPoint } from './types';

export interface Regression {
  /** Inclinação em unidades de y por dia. */
  slopePerDay: number;
  /** Valor ajustado em x = 0, onde x é medido em dias a partir de `originDate`. */
  intercept: number;
  originDate: string;
  /** Erro padrão da inclinação. Ver a ressalva sobre autocorrelação abaixo. */
  standardErrorSlope: number;
  /** Desvio padrão residual dos pontos em torno da reta. */
  residualStdDev: number;
  n: number;
  r2: number;
}

export interface RateResult {
  kgPerWeek: number;
  /** % do peso corporal por semana, assinado. Negativo = perda. */
  pctPerWeek: number;
  /** Peso de referência usado para converter kg em %: a tendência no fim da janela. */
  referenceWeightKg: number;
  n: number;
  windowDays: number;
  regression: Regression;
}

/**
 * Mínimos quadrados de y sobre x.
 *
 * RESSALVA IMPORTANTE sobre `standardErrorSlope`: quando os y são pontos de uma
 * tendência (EMA), eles são fortemente autocorrelacionados — cada um é construído
 * a partir do anterior — e a fórmula de mínimos quadrados pressupõe resíduos
 * independentes. O erro padrão sai otimista por cerca de uma ordem de grandeza.
 * Ele serve para comparar ajustes entre si, NUNCA para construir intervalo de
 * confiança que o usuário leia. A faixa da projeção usa a dispersão das pesagens
 * brutas — ver `projection.ts`.
 */
export function linearRegression(
  points: readonly { x: number; y: number }[],
): Regression | null {
  const n = points.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  // Todos os pontos na mesma data: a inclinação é indeterminada, não zero.
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let sse = 0;
  for (const p of points) {
    const predicted = intercept + slope * p.x;
    sse += (p.y - predicted) ** 2;
  }

  const degreesOfFreedom = n - 2;
  const residualVariance = degreesOfFreedom > 0 ? sse / degreesOfFreedom : 0;

  return {
    slopePerDay: slope,
    intercept,
    originDate: '',
    standardErrorSlope: degreesOfFreedom > 0 ? Math.sqrt(residualVariance / sxx) : 0,
    residualStdDev: Math.sqrt(residualVariance),
    n,
    r2: syy === 0 ? 1 : Math.max(0, 1 - sse / syy),
  };
}

/** Regressão sobre pontos datados, com x em dias desde o primeiro ponto da janela. */
export function regressOverDates(
  points: readonly { date: string; value: number }[],
): Regression | null {
  if (points.length === 0) return null;
  const origin = points[0]!.date;
  const result = linearRegression(
    points.map((p) => ({ x: daysBetween(origin, p.date), y: p.value })),
  );
  return result ? { ...result, originDate: origin } : null;
}

/** Pontos de tendência dentro da janela que termina em `asOfDate`, inclusive. */
export function trendPointsInWindow(
  trend: readonly TrendPoint[],
  asOfDate: string,
  windowDays: number,
): TrendPoint[] {
  return trend.filter((p) => {
    const age = daysBetween(p.date, asOfDate);
    return age >= 0 && age < windowDays;
  });
}

/**
 * Taxa de variação da tendência, por regressão linear na janela que termina em
 * `asOfDate`. É a "taxa semanal atual" mostrada no feedback da pesagem e no
 * gráfico 3.
 *
 * NÃO é o que classifica as semanas: a janela de 21 dias cobre três semanas, então
 * semanas consecutivas compartilhariam a maior parte dos dados e a regra de "duas
 * semanas seguidas fora do plano" deixaria de exigir duas evidências independentes.
 * A classificação usa o delta da tendência de uma semana para outra — ver
 * `classify.ts`.
 */
export function weeklyRate(
  trend: readonly TrendPoint[],
  asOfDate: string,
  windowDays: number = RATE_WINDOW_DAYS,
): RateResult | null {
  const window = trendPointsInWindow(trend, asOfDate, windowDays);
  if (window.length < RATE_MIN_POINTS) return null;

  const regression = regressOverDates(window.map((p) => ({ date: p.date, value: p.trendKg })));
  if (!regression) return null;

  // Converte kg em % do peso corporal usando a tendência no fim da janela: é o
  // peso atual, e é o que faz "% por semana" significar a mesma coisa ao longo de
  // meses em que o peso de referência muda.
  const referenceWeightKg = window[window.length - 1]!.trendKg;
  const kgPerWeek = regression.slopePerDay * 7;

  return {
    kgPerWeek,
    pctPerWeek: referenceWeightKg > 0 ? (kgPerWeek / referenceWeightKg) * 100 : 0,
    referenceWeightKg,
    n: window.length,
    windowDays,
    regression,
  };
}

/** Taxa alvo como valor assinado (negativo = perda), a partir da magnitude guardada. */
export function targetRateSigned(targetRatePctPerWeek: number): number {
  return -Math.abs(targetRatePctPerWeek);
}

/** Converte uma taxa em % do peso corporal por semana para kg por semana. */
export function pctPerWeekToKg(pctPerWeek: number, bodyWeightKg: number): number {
  return (pctPerWeek / 100) * bodyWeightKg;
}
