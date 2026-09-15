/**
 * Classificação das semanas e as regras dos avisos.
 *
 * MÉTRICA: a classificação de uma semana vem do DELTA DA TENDÊNCIA de um fim de
 * semana para o outro, normalizado para 7 dias — não da regressão de 21 dias.
 *
 * Por quê: 21 dias cobrem três semanas, então semanas consecutivas compartilham
 * cerca de dois terços dos dados. Um único fim de semana ruim marcaria duas
 * semanas seguidas como fora do plano por construção, e a regra do SPEC de "alerta
 * negativo apenas após 2 semanas seguidas fora do plano" deixaria de exigir duas
 * evidências independentes — que é exatamente o que ela existe para exigir.
 * Janelas semanais não se sobrepõem.
 *
 * A regressão de 21 dias continua sendo a "taxa semanal atual" do feedback e do
 * gráfico 3, onde a suavização é desejável. Ver `rate.ts`.
 */

import {
  CLASSIFICATION_WARMUP_DAYS,
  GOOD_WEEK_FRACTION_OF_TARGET,
  MAX_WEEK_COMPARISON_GAP_DAYS,
  PROGRESS_WEEK_FRACTION_OF_TARGET,
  WEEKS_OUT_OF_PLAN_BEFORE_ALERT,
} from '../config/thresholds';
import { daysBetween } from './dates';
import { targetRateSigned } from './rate';
import { computeTrend } from './trend';
import type { Settings, WeighIn } from './types';
import type { WeekClass } from './types';
import { summarizeWeeks, type WeekSummary } from './weekly';

export interface WeekClassification {
  week: WeekSummary;
  /** Variação da tendência normalizada para 7 dias. Negativo = perda. */
  kgPerWeek: number | null;
  /** A mesma variação em % do peso corporal. Negativo = perda. */
  pctPerWeek: number | null;
  klass: WeekClass | null;
  /** Data do ponto de tendência usado como referência anterior. */
  comparedToDate: string | null;
  /** Intervalo real, em dias, entre os dois pontos de tendência comparados. */
  gapDays: number | null;
  /** Por que a semana ficou sem classificação, quando for o caso. */
  reason?: 'sem-tendencia' | 'sem-referencia' | 'intervalo-longo' | 'aquecimento';
  /** Dias de tendência acumulada até o fim desta semana. */
  trendAgeDays?: number;
  /** Variação da média semanal frente à semana anterior, em % do peso corporal. */
  averageDeltaPctPerWeek?: number | null;
  /** A guarda de coerência rebaixou a classificação para neutra. */
  demotedByAverage?: boolean;
}

/**
 * Coloca uma taxa numa das quatro faixas.
 *
 * `pctPerWeek` e `noiseBandPct` são assinados/positivos conforme a convenção do
 * projeto: taxa negativa = perda, faixa de ruído sempre positiva.
 *
 * A faixa `progresso` não está no SPEC original. Foi acrescentada porque com alvo
 * de 0,5%/semana a fronteira única dos 75% cai em 0,375%/semana, e uma semana
 * perdendo 0,30%/semana — perda real e saudável — cairia na mesma caixa de um
 * platô. Repetido ao longo de meses isso lê como punitivo, contra o princípio de
 * tom do documento.
 */
export function classifyRate(
  pctPerWeek: number,
  targetRatePctPerWeek: number,
  noiseBandPct: number,
): WeekClass {
  const noise = Math.abs(noiseBandPct);

  // Subindo além do ruído.
  if (pctPerWeek > noise) return 'fora-do-plano';

  // Indistinguível de zero: variação dentro do ruído de água e sódio.
  if (Math.abs(pctPerWeek) <= noise) return 'neutra';

  // Perda real, acima do ruído. Onde ela cai depende da fração do alvo atingida.
  const target = Math.abs(targetRateSigned(targetRatePctPerWeek));
  if (target <= 0) return 'neutra';

  const fractionOfTarget = -pctPerWeek / target;
  if (fractionOfTarget >= GOOD_WEEK_FRACTION_OF_TARGET) return 'boa';
  if (fractionOfTarget >= PROGRESS_WEEK_FRACTION_OF_TARGET) return 'progresso';
  return 'neutra';
}

/**
 * Guarda de coerência entre a tendência e o que a balança mostrou.
 *
 * A classificação usa o delta da tendência, que é suavizado e por isso ATRASA cerca
 * de uma semana em relação à realidade. Numa reversão brusca o efeito é grande:
 * indo de -0,5%/semana para +0,6%/semana, a primeira semana ruim lê -0,33%/semana e
 * seria rotulada "progresso" — enquanto a média da semana subiu de forma visível.
 * Dizer "progresso" a quem viu a balança subir destrói a confiança no app mais
 * rápido do que qualquer alerta atrasado.
 *
 * A guarda rebaixa para `neutra` qualquer semana rotulada como perda cuja MÉDIA
 * SEMANAL subiu além da faixa de ruído.
 *
 * Ela é deliberadamente de mão única: só empurra na direção do neutro, nunca
 * promove nada para `fora-do-plano`. Como o alerta negativo só olha `fora-do-plano`,
 * é impossível esta guarda gerar um alarme falso — o pior que ela faz é deixar de
 * comemorar uma semana boa, o que acontece em cerca de 4% delas por ruído da média.
 */
function applyAverageCoherenceGuard(
  klass: WeekClass,
  averageDeltaPctPerWeek: number | null,
  noiseBandPct: number,
): { klass: WeekClass; demoted: boolean } {
  const isLossClass = klass === 'boa' || klass === 'progresso';
  if (!isLossClass || averageDeltaPctPerWeek === null) return { klass, demoted: false };
  if (averageDeltaPctPerWeek <= Math.abs(noiseBandPct)) return { klass, demoted: false };
  return { klass: 'neutra', demoted: true };
}

/**
 * Classifica todas as semanas da série.
 *
 * Cada semana é comparada com a última semana ANTERIOR que tenha ponto de
 * tendência, e o delta é normalizado pelo intervalo real em dias. Assim uma semana
 * perdida não faz a seguinte parecer ter caído o dobro.
 */
export function classifyWeeks(
  weighIns: readonly WeighIn[],
  settings: Settings,
): WeekClassification[] {
  const trend = computeTrend(weighIns);
  const weeks = summarizeWeeks(weighIns, settings.scheduleDays, trend);

  const out: WeekClassification[] = [];
  let previous: { date: string; trendKg: number } | null = null;
  // Início do trecho contínuo de tendência. Uma lacuna longa reinicia a EMA no
  // peso novo, então o aquecimento recomeça dali — não da primeira pesagem já
  // registrada, que pode ser de anos atrás.
  let trendStart = trend[0]?.date ?? '';

  for (const week of weeks) {
    if (week.trendAtEnd === null || week.trendAtEndDate === null) {
      out.push({
        week,
        kgPerWeek: null,
        pctPerWeek: null,
        klass: null,
        comparedToDate: null,
        gapDays: null,
        reason: 'sem-tendencia',
      });
      continue;
    }

    const current = { date: week.trendAtEndDate, trendKg: week.trendAtEnd };

    if (previous === null) {
      // A primeira semana da história não tem contra o que ser comparada.
      out.push({
        week,
        kgPerWeek: null,
        pctPerWeek: null,
        klass: null,
        comparedToDate: null,
        gapDays: null,
        reason: 'sem-referencia',
      });
      previous = current;
      continue;
    }

    const gapDays = daysBetween(previous.date, current.date);

    if (gapDays <= 0 || gapDays > MAX_WEEK_COMPARISON_GAP_DAYS) {
      out.push({
        week,
        kgPerWeek: null,
        pctPerWeek: null,
        klass: null,
        comparedToDate: previous.date,
        gapDays,
        reason: 'intervalo-longo',
      });
      previous = current;
      trendStart = current.date;
      continue;
    }

    // Aquecimento: antes de a EMA acumular o atraso de regime, o delta subestima
    // o ritmo de forma sistemática. Sem base suficiente, não afirmar nada.
    const trendAgeDays = daysBetween(trendStart, current.date);
    if (trendAgeDays < CLASSIFICATION_WARMUP_DAYS) {
      out.push({
        week,
        kgPerWeek: null,
        pctPerWeek: null,
        klass: null,
        comparedToDate: previous.date,
        gapDays,
        reason: 'aquecimento',
        trendAgeDays,
      });
      previous = current;
      continue;
    }

    const kgPerWeek = ((current.trendKg - previous.trendKg) / gapDays) * 7;
    const pctPerWeek = current.trendKg > 0 ? (kgPerWeek / current.trendKg) * 100 : 0;

    // Variação da média semanal, para a guarda de coerência. Usa a última semana
    // anterior que teve pesagens, normalizada pelo intervalo real entre as semanas.
    const previousWeekAverage = lastAverageBefore(out, week.weekStart);
    let averageDeltaPctPerWeek: number | null = null;
    if (week.averageKg !== null && previousWeekAverage !== null) {
      const weeksApart = daysBetween(previousWeekAverage.weekStart, week.weekStart) / 7;
      if (weeksApart > 0) {
        const deltaKg = (week.averageKg - previousWeekAverage.averageKg) / weeksApart;
        averageDeltaPctPerWeek = (deltaKg / week.averageKg) * 100;
      }
    }

    const raw = classifyRate(
      pctPerWeek,
      settings.targetRatePctPerWeek,
      settings.noiseBandPctPerWeek,
    );
    const guarded = applyAverageCoherenceGuard(
      raw,
      averageDeltaPctPerWeek,
      settings.noiseBandPctPerWeek,
    );

    out.push({
      week,
      kgPerWeek,
      pctPerWeek,
      klass: guarded.klass,
      comparedToDate: previous.date,
      gapDays,
      trendAgeDays,
      averageDeltaPctPerWeek,
      demotedByAverage: guarded.demoted,
    });

    previous = current;
  }

  return out;
}

/** Média da última semana com pesagens antes de `weekStart`. */
function lastAverageBefore(
  processed: readonly WeekClassification[],
  weekStart: string,
): { weekStart: string; averageKg: number } | null {
  for (let i = processed.length - 1; i >= 0; i--) {
    const candidate = processed[i]!.week;
    if (candidate.weekStart >= weekStart) continue;
    if (candidate.averageKg !== null) {
      return { weekStart: candidate.weekStart, averageKg: candidate.averageKg };
    }
  }
  return null;
}

/** Só as semanas que receberam classificação, em ordem cronológica. */
export function classifiedOnly(
  classifications: readonly WeekClassification[],
): (WeekClassification & { klass: WeekClass })[] {
  return classifications.filter(
    (c): c is WeekClassification & { klass: WeekClass } => c.klass !== null,
  );
}

/**
 * Comprimento da sequência de semanas com a classificação `klass` terminando na
 * última semana classificada.
 *
 * Semanas SEM classificação interrompem a sequência: sem dado não dá para afirmar
 * que a sequência continuou, e afirmar que continuou seria inventar informação.
 */
export function streakOf(
  classifications: readonly WeekClassification[],
  klass: WeekClass,
): number {
  let streak = 0;
  for (let i = classifications.length - 1; i >= 0; i--) {
    const current = classifications[i]!;
    // Semanas ainda sem nenhuma pesagem no fim da lista são ignoradas, não
    // contadas como quebra: a semana corrente costuma estar nesse estado.
    if (current.klass === null && current.week.count === 0 && streak === 0) continue;
    if (current.klass !== klass) break;
    streak += 1;
  }
  return streak;
}

/** A sequência corrente: qual classificação e há quantas semanas ela se repete. */
export function currentStreak(
  classifications: readonly WeekClassification[],
): { klass: WeekClass; length: number } | null {
  const classified = classifiedOnly(classifications);
  const last = classified[classified.length - 1];
  if (!last) return null;
  return { klass: last.klass, length: streakOf(classifications, last.klass) };
}

/**
 * Quantas semanas seguidas fora do plano terminam na última semana classificada.
 * É o contador que governa o único aviso negativo do app.
 */
export function outOfPlanStreak(classifications: readonly WeekClassification[]): number {
  return streakOf(classifications, 'fora-do-plano');
}

/**
 * Se o app deve emitir um alerta negativo.
 *
 * Regra do SPEC, e é a regra de tom mais importante do projeto: uma única semana
 * fora do plano recebe mensagem neutra e contextual, nunca alarme. Só duas semanas
 * seguidas caracterizam um padrão que vale apontar.
 */
export function shouldAlert(classifications: readonly WeekClassification[]): boolean {
  return outOfPlanStreak(classifications) >= WEEKS_OUT_OF_PLAN_BEFORE_ALERT;
}

/** A última semana que recebeu classificação, se houver. */
export function lastClassifiedWeek(
  classifications: readonly WeekClassification[],
): (WeekClassification & { klass: WeekClass }) | null {
  const classified = classifiedOnly(classifications);
  return classified[classified.length - 1] ?? null;
}
