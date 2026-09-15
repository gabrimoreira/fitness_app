/** Tipos do domínio. Compartilhados entre `src/stats/` (puro) e o resto do app. */

/** Uma pesagem. Uma por dia: registrar de novo no mesmo dia substitui a anterior. */
export interface WeighIn {
  id: string;
  /** YYYY-MM-DD, sempre em data local. Nunca parsear com `new Date(string)`. */
  date: string;
  weightKg: number;
  source: 'manual' | 'mfp-import';
  note?: string;
}

export interface Settings {
  heightCm?: number;
  goalWeightKg?: number;
  /** Perda desejada em % do peso corporal por semana, POSITIVO. Padrão 0.5. */
  targetRatePctPerWeek: number;
  /** Faixa de ruído em % do peso corporal por semana, positivo. Padrão 0.15. */
  noiseBandPctPerWeek: number;
  /** 0=domingo .. 6=sábado. Padrão [1, 3, 5] = seg, qua, sex. */
  scheduleDays: number[];
  startDate?: string;
}

/** Uma pesagem com sua tendência causal já calculada. */
export interface TrendPoint {
  date: string;
  weightKg: number;
  /** EMA ajustada ao tempo, calculada apenas com dados até esta data (inclusive). */
  trendKg: number;
}

/** Classificação de uma semana. `progresso` é um acréscimo ao SPEC — ver thresholds.ts. */
export type WeekClass = 'boa' | 'progresso' | 'neutra' | 'fora-do-plano';
