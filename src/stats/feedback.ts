/**
 * Feedback da pesagem: o momento de motivação do app.
 *
 * Este módulo devolve DADOS, nunca strings prontas de interface. A camada de UI
 * decide como apresentar. Assim as regras de tom ficam testáveis sem renderizar
 * nada, e é o tom que mais importa acertar aqui.
 *
 * Princípios que as funções abaixo materializam:
 *  - nenhuma conclusão sai de uma pesagem isolada; tudo passa por tendência ou média;
 *  - uma semana ruim é informação contextual, nunca bronca;
 *  - alerta negativo só depois de duas semanas seguidas fora do plano.
 */

import { RATE_WINDOW_DAYS } from '../config/thresholds';
import {
  classifyWeeks,
  lastClassifiedWeek,
  outOfPlanStreak,
  shouldAlert,
  streakOf,
  type WeekClassification,
} from './classify';
import { dayOfWeek, weekStart } from './dates';
import {
  latestReboundInContext,
  sameDayLastWeek,
  type Rebound,
} from './dayOfWeek';
import { evaluateMilestones, type Milestone } from './milestones';
import { weeklyRate, type RateResult } from './rate';
import { computeTrend, trendAsOf } from './trend';
import type { Settings, WeekClass, WeighIn } from './types';
import { completeWeekStreak, summarizeWeeks, weekAdherence, type Adherence } from './weekly';

export interface SameDayComparison {
  previousDate: string;
  previousKg: number;
  deltaKg: number;
}

export interface WeekClosing {
  klass: WeekClass;
  kgPerWeek: number;
  pctPerWeek: number;
  /** Quantas semanas seguidas com esta mesma classificação, incluindo esta. */
  streak: number;
  /** Semanas seguidas fora do plano. Governa o alerta. */
  outOfPlanStreak: number;
  /** Só é verdadeiro a partir de duas semanas seguidas fora do plano. */
  isAlert: boolean;
  /** Dados que ajudam a entender a semana ruim, quando há alerta. */
  context: {
    reboundAboveAverage: boolean;
    latestReboundKg: number | null;
    averageReboundKg: number | null;
    missedWeighIns: number;
  };
}

export interface ReboundFeedback {
  current: Rebound;
  historicalAverageKg: number | null;
  /** Este fim de semana foi melhor que o típico. Nulo se não há histórico. */
  betterThanUsual: boolean | null;
}

export interface WeighInFeedback {
  date: string;
  weightKg: number;
  /** Hoje é um dia programado do ritual. */
  isScheduledDay: boolean;
  /** A pesagem substituiu outra do mesmo dia. */
  replacedExisting: boolean;

  trendKg: number | null;
  /** Variação da tendência desde a pesagem anterior. Negativo = caiu. */
  trendDeltaKg: number | null;

  /** Comparação com o mesmo dia da semana anterior (seg vs seg), não com a última pesagem. */
  sameDayLastWeek: SameDayComparison | null;

  /** Preenchido nas segundas-feiras. */
  rebound: ReboundFeedback | null;

  /** Preenchido quando a pesagem fecha a semana (último dia programado). */
  weekClosing: WeekClosing | null;

  rate: RateResult | null;
  adherence: Adherence;
  completeWeekStreak: number;

  milestones: Milestone[];
  isNewLow: boolean;
}

/**
 * Se `date` é o último dia programado da sua semana — o momento de fechar a semana.
 *
 * Normalmente é a sexta. Se a sexta foi perdida, o fechamento não acontece naquele
 * dia; a UI fecha a semana na primeira abertura seguinte, como o SPEC prevê.
 */
export function isWeekClosingDay(date: string, scheduleDays: readonly number[]): boolean {
  if (scheduleDays.length === 0) return false;
  // Ordena pela POSIÇÃO na semana ISO, não pelo número do dia: domingo é 0 em
  // `getDay()` mas é o último dia de uma semana que começa na segunda. Ordenar
  // pelo número cru faria um ritual que inclui domingo fechar a semana na quarta.
  const isoPosition = (dow: number) => (dow === 0 ? 6 : dow - 1);
  const last = [...scheduleDays].sort((a, b) => isoPosition(a) - isoPosition(b)).at(-1);
  return last !== undefined && dayOfWeek(date) === last;
}

/**
 * Monta o feedback completo de uma pesagem.
 *
 * `weighIns` já deve conter a pesagem de `date`: o feedback descreve o estado do
 * mundo depois de salvar, que é o que o usuário vê na tela seguinte.
 */
export function buildWeighInFeedback(
  weighIns: readonly WeighIn[],
  settings: Settings,
  date: string,
  options: { replacedExisting?: boolean; reachedMilestoneIds?: readonly string[] } = {},
): WeighInFeedback | null {
  const trend = computeTrend(weighIns);
  const todayPoint = trend.find((p) => p.date === date);
  if (!todayPoint) return null;

  const index = trend.indexOf(todayPoint);
  const previousPoint = index > 0 ? trend[index - 1] : undefined;

  const previousSameDay = sameDayLastWeek(weighIns, date);
  const classifications = classifyWeeks(weighIns, settings);

  const milestoneEval = evaluateMilestones(
    trend,
    options.reachedMilestoneIds ?? [],
    settings.goalWeightKg,
  );

  return {
    date,
    weightKg: todayPoint.weightKg,
    isScheduledDay: settings.scheduleDays.includes(dayOfWeek(date)),
    replacedExisting: options.replacedExisting ?? false,

    trendKg: todayPoint.trendKg,
    trendDeltaKg: previousPoint ? todayPoint.trendKg - previousPoint.trendKg : null,

    sameDayLastWeek: previousSameDay
      ? {
          previousDate: previousSameDay.date,
          previousKg: previousSameDay.weightKg,
          deltaKg: todayPoint.weightKg - previousSameDay.weightKg,
        }
      : null,

    rebound: buildReboundFeedback(weighIns, date),
    weekClosing: buildWeekClosing(weighIns, settings, date, classifications),

    rate: weeklyRate(trend, date, RATE_WINDOW_DAYS),
    adherence: weekAdherence(weighIns, settings.scheduleDays, date),
    completeWeekStreak: completeWeekStreak(
      summarizeWeeks(weighIns, settings.scheduleDays, trend),
      date,
    ),

    milestones: milestoneEval.newlyReached,
    isNewLow: milestoneEval.isNewLow,
  };
}

/** Rebote do fim de semana, só faz sentido na segunda-feira. */
function buildReboundFeedback(
  weighIns: readonly WeighIn[],
  date: string,
): ReboundFeedback | null {
  if (dayOfWeek(date) !== 1) return null;

  const context = latestReboundInContext(weighIns, date);
  if (!context || context.current.mondayDate !== date) return null;

  return {
    current: context.current,
    historicalAverageKg: context.historicalAverageKg,
    // "Abaixo do seu rebote médio" é uma boa notícia: ganhou menos que o costume.
    betterThanUsual:
      context.historicalAverageKg === null
        ? null
        : context.current.deltaKg < context.historicalAverageKg,
  };
}

/** Fechamento da semana, com a classificação e o contexto do alerta. */
function buildWeekClosing(
  weighIns: readonly WeighIn[],
  settings: Settings,
  date: string,
  classifications: readonly WeekClassification[],
): WeekClosing | null {
  if (!isWeekClosingDay(date, settings.scheduleDays)) return null;

  const thisWeek = weekStart(date);
  const closing = classifications.find((c) => c.week.weekStart === thisWeek);
  if (!closing || closing.klass === null) return null;

  // O corte em `date` garante que sequências e alerta considerem apenas o que já
  // aconteceu — nunca semanas futuras de um histórico importado.
  const upToNow = classifications.filter((c) => c.week.weekStart <= thisWeek);
  const reboundContext = latestReboundInContext(weighIns, date);
  const averageRebound = reboundContext?.historicalAverageKg ?? null;
  const latestRebound = reboundContext?.current.deltaKg ?? null;

  return {
    klass: closing.klass,
    kgPerWeek: closing.kgPerWeek ?? 0,
    pctPerWeek: closing.pctPerWeek ?? 0,
    streak: streakOf(upToNow, closing.klass),
    outOfPlanStreak: outOfPlanStreak(upToNow),
    isAlert: shouldAlert(upToNow),
    context: {
      reboundAboveAverage:
        latestRebound !== null && averageRebound !== null && latestRebound > averageRebound,
      latestReboundKg: latestRebound,
      averageReboundKg: averageRebound,
      missedWeighIns: closing.week.missedDates.length,
    },
  };
}

/**
 * Estado resumido para a tela inicial, sem depender de ter havido pesagem hoje.
 */
export interface DashboardState {
  trendKg: number | null;
  rate: RateResult | null;
  adherence: Adherence;
  completeWeekStreak: number;
  lastClosedWeek: (WeekClassification & { klass: WeekClass }) | null;
  outOfPlanStreak: number;
  isAlert: boolean;
}

export function buildDashboardState(
  weighIns: readonly WeighIn[],
  settings: Settings,
  asOfDate: string,
): DashboardState {
  const trend = computeTrend(weighIns);
  const classifications = classifyWeeks(weighIns, settings).filter(
    (c) => c.week.weekStart < weekStart(asOfDate),
  );

  return {
    trendKg: trendAsOf(trend, asOfDate),
    rate: weeklyRate(trend, asOfDate, RATE_WINDOW_DAYS),
    adherence: weekAdherence(weighIns, settings.scheduleDays, asOfDate),
    completeWeekStreak: completeWeekStreak(
      summarizeWeeks(weighIns, settings.scheduleDays, trend),
      asOfDate,
    ),
    lastClosedWeek: lastClassifiedWeek(classifications),
    outOfPlanStreak: outOfPlanStreak(classifications),
    isAlert: shouldAlert(classifications),
  };
}
