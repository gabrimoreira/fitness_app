/**
 * Agrupamento semanal: semana ISO de segunda a domingo.
 *
 * Uma semana só é "completa" quando todos os dias PROGRAMADOS dela tiveram pesagem.
 * O SPEC fala em três pesagens, mas `scheduleDays` é configurável, então a conta é
 * sobre os dias programados daquela semana e não sobre o número fixo 3 — senão
 * mudar o ritual para quatro dias marcaria todas as semanas como incompletas para
 * sempre.
 */

import { addDays, dayOfWeek, isoWeekLabel, weekStart } from './dates';
import { dedupeByDate, lastTrendPointInRange } from './trend';
import type { TrendPoint, WeighIn } from './types';

export interface WeekSummary {
  /** Segunda-feira da semana, `YYYY-MM-DD`. É a chave estável de agrupamento. */
  weekStart: string;
  /** Domingo que fecha a semana. */
  weekEnd: string;
  /** Rótulo curto para exibição, ex.: "S38/2026". */
  label: string;
  weighIns: WeighIn[];
  /** Média simples das pesagens da semana. Nulo se não houve nenhuma. */
  averageKg: number | null;
  count: number;
  /** Quantos dias programados essa semana tinha. */
  scheduledCount: number;
  /** Em quantos deles houve pesagem. */
  scheduledMet: number;
  /** Datas dos dias programados sem pesagem. */
  missedDates: string[];
  /** Todos os dias programados foram cumpridos. Semanas parciais são exibidas esmaecidas. */
  isComplete: boolean;
  /** Último valor da tendência dentro da semana. Base da classificação. */
  trendAtEnd: number | null;
  /** Data desse último ponto de tendência, para medir o intervalo real entre semanas. */
  trendAtEndDate: string | null;
}

/** As datas dos dias programados dentro da semana que começa em `monday`. */
export function scheduledDatesInWeek(monday: string, scheduleDays: readonly number[]): string[] {
  const wanted = new Set(scheduleDays);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    if (wanted.has(dayOfWeek(date))) dates.push(date);
  }
  return dates;
}

/**
 * Agrupa as pesagens em semanas ISO contíguas, da primeira à última pesagem.
 *
 * Semanas sem nenhuma pesagem aparecem na lista com `count: 0` — uma lacuna no
 * ritual é informação, e some se a semana for simplesmente omitida do array.
 */
export function summarizeWeeks(
  weighIns: readonly WeighIn[],
  scheduleDays: readonly number[],
  trend?: readonly TrendPoint[],
): WeekSummary[] {
  const series = dedupeByDate(weighIns);
  if (series.length === 0) return [];

  const byWeek = new Map<string, WeighIn[]>();
  for (const w of series) {
    const key = weekStart(w.date);
    const bucket = byWeek.get(key);
    if (bucket) bucket.push(w);
    else byWeek.set(key, [w]);
  }

  const firstWeek = weekStart(series[0]!.date);
  const lastWeek = weekStart(series[series.length - 1]!.date);

  const summaries: WeekSummary[] = [];
  for (let monday = firstWeek; monday <= lastWeek; monday = addDays(monday, 7)) {
    const sunday = addDays(monday, 6);
    const inWeek = byWeek.get(monday) ?? [];
    const scheduled = scheduledDatesInWeek(monday, scheduleDays);
    const present = new Set(inWeek.map((w) => w.date));
    const missedDates = scheduled.filter((d) => !present.has(d));
    const scheduledMet = scheduled.length - missedDates.length;

    const trendPoint = trend ? lastTrendPointInRange(trend, monday, sunday) : null;

    summaries.push({
      weekStart: monday,
      weekEnd: sunday,
      label: isoWeekLabel(monday),
      weighIns: inWeek,
      averageKg:
        inWeek.length > 0 ? inWeek.reduce((s, w) => s + w.weightKg, 0) / inWeek.length : null,
      count: inWeek.length,
      scheduledCount: scheduled.length,
      scheduledMet,
      missedDates,
      // Uma semana sem nenhum dia programado (configuração vazia) não é "completa".
      isComplete: scheduled.length > 0 && missedDates.length === 0,
      trendAtEnd: trendPoint?.trendKg ?? null,
      trendAtEndDate: trendPoint?.date ?? null,
    });
  }

  return summaries;
}

/** A semana que contém `date`, se existir no resumo. */
export function findWeek(weeks: readonly WeekSummary[], date: string): WeekSummary | null {
  const key = weekStart(date);
  return weeks.find((w) => w.weekStart === key) ?? null;
}

/**
 * Aderência da semana corrente: dias programados cumpridos até agora.
 * Alimenta o indicador ●●○ da tela inicial.
 */
export interface Adherence {
  scheduledCount: number;
  met: number;
  /** Um marcador por dia programado, na ordem da semana. */
  marks: { date: string; done: boolean; isFuture: boolean }[];
}

export function weekAdherence(
  weighIns: readonly WeighIn[],
  scheduleDays: readonly number[],
  asOfDate: string,
): Adherence {
  const monday = weekStart(asOfDate);
  const scheduled = scheduledDatesInWeek(monday, scheduleDays);
  const present = new Set(dedupeByDate(weighIns).map((w) => w.date));

  const marks = scheduled.map((date) => ({
    date,
    done: present.has(date),
    isFuture: date > asOfDate,
  }));

  return {
    scheduledCount: scheduled.length,
    met: marks.filter((m) => m.done).length,
    marks,
  };
}

/**
 * Quantas semanas completas consecutivas terminam na última semana JÁ ENCERRADA.
 *
 * A semana corrente fica de fora de propósito: ela ainda está em curso e contá-la
 * como incompleta zeraria a sequência do usuário toda segunda-feira.
 */
export function completeWeekStreak(
  weeks: readonly WeekSummary[],
  asOfDate: string,
): number {
  const currentWeek = weekStart(asOfDate);
  let streak = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    const week = weeks[i]!;
    if (week.weekStart >= currentWeek) continue;
    if (!week.isComplete) break;
    streak += 1;
  }
  return streak;
}
