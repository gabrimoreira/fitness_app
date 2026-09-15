/**
 * Gerador de dados sintéticos para desenvolvimento e teste.
 *
 * Determinístico: a mesma semente produz sempre a mesma série, para que gráficos e
 * mensagens possam ser conferidos e comparados entre execuções.
 *
 * O objetivo não é parecer bonito e sim exercitar todos os caminhos do app: tem
 * fase boa, platô, um trecho fora do plano longo o bastante para disparar o alerta
 * de duas semanas, recuperação, efeito de fim de semana, ruído de água e sódio e
 * algumas pesagens perdidas.
 */

import { addDays, dayOfWeek, weekStart } from './dates';
import type { WeighIn } from './types';

/** PRNG determinístico (mulberry32). Não é criptográfico — é reprodutibilidade. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normal padrão por Box-Muller, a partir de um uniforme determinístico. */
function normal(random: () => number): number {
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface SeedOptions {
  seed?: number;
  /** Data da última pesagem gerada. As demais recuam a partir dela. */
  endDate?: string;
  startWeightKg?: number;
  scheduleDays?: number[];
  /** Desvio padrão do ruído diário de água e sódio, em kg. */
  noiseSdKg?: number;
  /** Quanto a segunda-feira vem acima da linha de base, em kg. */
  weekendEffectKg?: number;
  /** Probabilidade de perder uma pesagem programada. */
  missRate?: number;
  /** Fases do período, cada uma com duração em semanas e taxa em %/semana. */
  phases?: { weeks: number; ratePctPerWeek: number }[];
}

/**
 * Fases padrão: ~26 semanas (6 meses) cobrindo os casos que o app precisa tratar.
 *
 * O trecho de 3 semanas fora do plano existe de propósito: são necessárias 3 para
 * que a classificação, que usa a tendência suavizada e por isso atrasa cerca de uma
 * semana, registre 2 semanas seguidas fora do plano e o alerta chegue a disparar.
 * Com 2 semanas o alerta não dispara, e o seed não exercitaria esse caminho.
 */
export const DEFAULT_PHASES = [
  { weeks: 6, ratePctPerWeek: -0.55 }, // início animado
  { weeks: 4, ratePctPerWeek: -0.45 }, // ritmo bom, no alvo
  { weeks: 3, ratePctPerWeek: -0.08 }, // platô
  { weeks: 3, ratePctPerWeek: 0.45 }, // fora do plano: viagem, fim de ano
  { weeks: 5, ratePctPerWeek: -0.5 }, // recuperação
  { weeks: 5, ratePctPerWeek: -0.3 }, // ritmo moderado, faixa "progresso"
];

/**
 * Gera uma série de pesagens sintética.
 *
 * O peso de cada dia é `linhaDeBase + efeitoDoDia + ruído`, onde a linha de base
 * segue as fases de taxa. O efeito de fim de semana incide sobre a segunda-feira,
 * e um resíduo menor sobre a quarta, imitando a volta gradual à linha de base.
 */
export function generateSeed(options: SeedOptions = {}): WeighIn[] {
  const {
    seed = 20260915,
    endDate = '2026-09-14',
    startWeightKg = 92.4,
    scheduleDays = [1, 3, 5],
    noiseSdKg = 0.35,
    weekendEffectKg = 0.55,
    missRate = 0.06,
    phases = DEFAULT_PHASES,
  } = options;

  const random = makeRandom(seed);
  const totalWeeks = phases.reduce((sum, p) => sum + p.weeks, 0);
  const totalDays = totalWeeks * 7;

  // Recua até a segunda-feira que abre o período. Tem que ser a segunda ANTERIOR:
  // avançar até a próxima empurraria a série inteira para frente e a última
  // pesagem passaria de `endDate`.
  let cursor = weekStart(addDays(endDate, -(totalDays - 1)));

  const scheduled = new Set(scheduleDays);
  const out: WeighIn[] = [];
  let baseline = startWeightKg;

  for (const phase of phases) {
    for (let day = 0; day < phase.weeks * 7; day++) {
      const date = cursor;
      cursor = addDays(cursor, 1);

      baseline += ((phase.ratePctPerWeek / 100) * baseline) / 7;

      if (!scheduled.has(dayOfWeek(date))) continue;
      if (random() < missRate) continue; // pesagem perdida

      const dow = dayOfWeek(date);
      // Segunda carrega o fim de semana inteiro; quarta ainda tem um resíduo.
      const dayEffect = dow === 1 ? weekendEffectKg : dow === 3 ? weekendEffectKg * 0.2 : 0;

      const weightKg = baseline + dayEffect + normal(random) * noiseSdKg;
      out.push({
        id: `seed-${date}`,
        date,
        weightKg: Math.round(weightKg * 10) / 10, // a balança mostra 1 casa decimal
        source: 'manual',
      });
    }
  }

  return out;
}
