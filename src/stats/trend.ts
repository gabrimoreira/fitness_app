/**
 * Tendência: média móvel exponencial ajustada ao intervalo entre pesagens.
 *
 * O peso diário carrega ruído de água e sódio que chega a vários décimos de quilo,
 * maior do que a variação real de gordura em dias. A tendência é o que o app usa
 * para qualquer interpretação — nenhuma conclusão sai de uma pesagem isolada.
 */

import { EMA_DAILY_RETENTION } from '../config/thresholds';
import { daysBetween } from './dates';
import type { DeviationPoint, TrendPoint, WeighIn } from './types';

/**
 * Fator de suavização para um intervalo de `days` dias.
 *
 * `alpha = 1 - retention^days`
 *
 * Com pesagens seg/qua/sex o intervalo alterna entre 2 e 3 dias, e um alpha fixo
 * daria peso igual a intervalos diferentes — o salto de sexta para segunda, que
 * cobre o fim de semana inteiro, entraria com o mesmo peso do de segunda para
 * quarta. A forma exponencial faz o peso crescer com o tempo decorrido e é
 * consistente para qualquer espaçamento, inclusive as lacunas irregulares do
 * histórico importado.
 */
export function alphaForGap(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 0;
  return 1 - Math.pow(EMA_DAILY_RETENTION, days);
}

/** Ordena por data (crescente) sem mutar a entrada. */
export function sortByDate<T extends { date: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Deduplica por data mantendo o último registro de cada dia.
 *
 * O modelo é "uma pesagem por dia, nova pesagem substitui". Uma importação pode
 * trazer duplicatas, e os cálculos assumem datas únicas e crescentes.
 */
export function dedupeByDate(weighIns: readonly WeighIn[]): WeighIn[] {
  const byDate = new Map<string, WeighIn>();
  for (const w of weighIns) byDate.set(w.date, w);
  return sortByDate([...byDate.values()]);
}

/**
 * Tendência causal: em cada ponto usa apenas dados até aquela data, inclusive.
 * É a tendência oficial do app — a que aparece nos gráficos, alimenta a taxa e
 * classifica as semanas. Só ela pode ser mostrada como "a tendência de hoje",
 * porque é a única que existiria no dia em que a pesagem foi feita.
 */
export function computeTrend(weighIns: readonly WeighIn[]): TrendPoint[] {
  const series = dedupeByDate(weighIns);
  const out: TrendPoint[] = [];
  let trend = 0;

  for (let i = 0; i < series.length; i++) {
    const w = series[i];
    if (!w) continue;
    if (i === 0) {
      // A tendência começa no primeiro peso registrado (regra do SPEC).
      trend = w.weightKg;
    } else {
      const prev = series[i - 1];
      const gap = prev ? daysBetween(prev.date, w.date) : 1;
      const alpha = alphaForGap(gap);
      trend = trend + alpha * (w.weightKg - trend);
    }
    out.push({ date: w.date, weightKg: w.weightKg, trendKg: trend });
  }

  return out;
}

/**
 * Linha de base para medir o desvio de cada dia da semana (gráfico 4).
 *
 * Média das pesagens numa janela centrada de UMA SEMANA (±3 dias, o ponto incluído).
 *
 * É a decomposição sazonal clássica: uma janela com exatamente o comprimento do
 * período contém uma ocorrência de cada dia programado, então a base não pende para
 * nenhum dia da semana. A partir de uma segunda a janela pega {sexta, segunda,
 * quarta}; de uma quarta, {segunda, quarta, sexta}; de uma sexta, {quarta, sexta,
 * segunda}. Sempre uma de cada.
 *
 * POR QUE NÃO AS ALTERNATIVAS ÓBVIAS — numa série de teste em que a segunda é
 * +1,0 kg acima dos demais dias, o desvio verdadeiro da segunda é +0,667 (a base
 * inclui as próprias segundas, então os desvios da semana somam zero):
 *
 *   `peso - trend` causal, como no SPEC ........ +0,47  (~30% a menos)
 *       A tendência já absorveu o peso do dia e se deslocou na direção do desvio.
 *   média de duas EMAs, ida e volta ............ +0,556 (~17% a menos)
 *       As duas passagens continuam incluindo o ponto.
 *   EMAs ida e volta excluindo o ponto ......... +0,719 (~8% a mais)
 *       Sem o ponto, a vizinhança imediata de uma segunda é quarta e sexta — os
 *       dias baixos — e a base afunda.
 *   média centrada de uma semana (esta) ........ +0,667 (exato)
 *
 * Viés residual conhecido: os pontos da janela não são perfeitamente simétricos no
 * tempo (de uma segunda, a sexta está a -3 dias e a quarta a +2), então uma
 * tendência em queda deixa um resto da ordem de 0,02 kg a 0,5%/semana — cerca de 3%
 * de um efeito de fim de semana típico, e abaixo da resolução da balança.
 *
 * NÃO USE em nada que o usuário leia como "a tendência de hoje": cada ponto depende
 * de pesagens futuras e muda conforme novas pesagens chegam. É análise
 * retrospectiva, não série temporal ao vivo.
 */
export function computeDeviationBaseline(
  weighIns: readonly WeighIn[],
  halfWindowDays = 3,
): DeviationPoint[] {
  const series = dedupeByDate(weighIns);

  return series.map((point) => {
    let sum = 0;
    let count = 0;
    let reachesBack = false;
    let reachesForward = false;

    for (const other of series) {
      const offset = daysBetween(point.date, other.date);
      if (Math.abs(offset) > halfWindowDays) continue;
      sum += other.weightKg;
      count += 1;
      // Uma janela truncada numa das pontas da série daria uma base enviesada:
      // exige cobertura dos dois lados antes de aceitar o ponto.
      if (offset <= -2) reachesBack = true;
      if (offset >= 2) reachesForward = true;
    }

    const usable = count >= 3 && reachesBack && reachesForward;
    const baselineKg = usable ? sum / count : null;
    return {
      date: point.date,
      weightKg: point.weightKg,
      baselineKg,
      deviationKg: baselineKg === null ? null : point.weightKg - baselineKg,
    };
  });
}

/** Valor da tendência na última pesagem em `date` ou antes dela. */
export function trendAsOf(trend: readonly TrendPoint[], date: string): number | null {
  let result: number | null = null;
  for (const p of trend) {
    if (p.date <= date) result = p.trendKg;
    else break;
  }
  return result;
}

/** Último ponto de tendência dentro do intervalo fechado [from, to]. */
export function lastTrendPointInRange(
  trend: readonly TrendPoint[],
  from: string,
  to: string,
): TrendPoint | null {
  let result: TrendPoint | null = null;
  for (const p of trend) {
    if (p.date >= from && p.date <= to) result = p;
    else if (p.date > to) break;
  }
  return result;
}

/** Menor valor já atingido pela tendência, e quando. */
export function trendLow(trend: readonly TrendPoint[]): TrendPoint | null {
  let best: TrendPoint | null = null;
  for (const p of trend) {
    if (best === null || p.trendKg < best.trendKg) best = p;
  }
  return best;
}
