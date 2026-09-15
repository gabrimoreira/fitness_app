/**
 * Marcos: os únicos avisos celebratórios fora do fechamento de semana.
 *
 * Todos são de PATAMAR e disparam uma única vez. O SPEC também listava "novo menor
 * valor de tendência" como marco, mas durante uma descida constante isso é
 * literalmente toda pesagem — três celebrações por semana, que deixam de significar
 * alguma coisa. O novo mínimo virou indicador visual discreto (`isNewLow`), sem
 * celebração.
 */

import {
  MILESTONE_EVERY_KG,
  MILESTONE_EVERY_PCT,
  MILESTONE_HYSTERESIS_KG,
} from '../config/thresholds';
import type { TrendPoint } from './types';

export type MilestoneKind = 'kg' | 'pct' | 'meta';

export interface Milestone {
  /** Identificador estável, usado para lembrar que já foi comemorado. */
  id: string;
  kind: MilestoneKind;
  /** Quantidade do patamar: 3 para "-3 kg", 5 para "-5%". */
  value: number;
  /** Peso de tendência que precisa ser atingido ou superado. */
  thresholdKg: number;
}

/**
 * Todos os patamares entre o peso inicial e o peso atual, alcançados ou não.
 *
 * O peso inicial é o da primeira tendência registrada: é o ponto a partir do qual
 * faz sentido contar "quanto eu já perdi".
 */
export function milestonesUpTo(
  startTrendKg: number,
  lowestTrendKg: number,
  goalWeightKg?: number,
): Milestone[] {
  const out: Milestone[] = [];
  const lost = startTrendKg - lowestTrendKg;
  if (lost <= 0 && goalWeightKg === undefined) return out;

  for (let kg = MILESTONE_EVERY_KG; kg <= lost; kg += MILESTONE_EVERY_KG) {
    out.push({ id: `kg-${kg}`, kind: 'kg', value: kg, thresholdKg: startTrendKg - kg });
  }

  const lostPct = (lost / startTrendKg) * 100;
  for (let pct = MILESTONE_EVERY_PCT; pct <= lostPct; pct += MILESTONE_EVERY_PCT) {
    out.push({
      id: `pct-${pct}`,
      kind: 'pct',
      value: pct,
      thresholdKg: startTrendKg * (1 - pct / 100),
    });
  }

  if (goalWeightKg !== undefined && lowestTrendKg <= goalWeightKg) {
    out.push({ id: 'meta', kind: 'meta', value: goalWeightKg, thresholdKg: goalWeightKg });
  }

  return out.sort((a, b) => b.thresholdKg - a.thresholdKg);
}

export interface MilestoneEvaluation {
  /** Marcos atingidos agora e ainda não comemorados. */
  newlyReached: Milestone[];
  /** Todos os ids já atingidos, para persistir. */
  reachedIds: string[];
  /** A tendência atual é o menor valor da história. Indicador discreto, sem alarde. */
  isNewLow: boolean;
  lowestTrendKg: number | null;
}

/**
 * Avalia quais marcos foram atingidos, respeitando os já comemorados.
 *
 * HISTERESE: um marco só conta como atingido quando a tendência chega a
 * `thresholdKg`, e não é "desfeito" por uma subida menor que
 * `MILESTONE_HYSTERESIS_KG`. Sem isso, uma tendência oscilando em torno de um
 * patamar entraria e sairia dele, e o app comemoraria o mesmo quilo repetidamente
 * — que é exatamente o tipo de aviso que perde o sentido por repetição.
 *
 * Marcos já comemorados nunca são recomemorados, mesmo que o peso volte a subir
 * muito depois: a pessoa chegou lá, e isso aconteceu.
 */
export function evaluateMilestones(
  trend: readonly TrendPoint[],
  alreadyReachedIds: readonly string[],
  goalWeightKg?: number,
): MilestoneEvaluation {
  const first = trend[0];
  const current = trend[trend.length - 1];
  if (!first || !current) {
    return {
      newlyReached: [],
      reachedIds: [...alreadyReachedIds],
      isNewLow: false,
      lowestTrendKg: null,
    };
  }

  let lowest = first.trendKg;
  for (const point of trend) lowest = Math.min(lowest, point.trendKg);

  const known = new Set(alreadyReachedIds);
  const candidates = milestonesUpTo(first.trendKg, lowest, goalWeightKg);

  const newlyReached = candidates.filter((milestone) => {
    if (known.has(milestone.id)) return false;
    // A histerese exige que a tendência tenha realmente cruzado o patamar, com
    // folga, e não apenas encostado nele dentro da oscilação normal.
    return current.trendKg <= milestone.thresholdKg + MILESTONE_HYSTERESIS_KG;
  });

  return {
    newlyReached,
    reachedIds: [...new Set([...alreadyReachedIds, ...newlyReached.map((m) => m.id)])],
    // O mínimo é novo quando a última tendência é o menor valor da série.
    isNewLow: trend.length > 1 && current.trendKg <= lowest + 1e-9,
    lowestTrendKg: lowest,
  };
}

/** Texto curto do marco, em pt-BR. */
export function milestoneLabel(milestone: Milestone): string {
  switch (milestone.kind) {
    case 'kg':
      return `${milestone.value} kg a menos na tendência`;
    case 'pct':
      return `${milestone.value}% do peso inicial`;
    case 'meta':
      return 'meta atingida';
  }
}
