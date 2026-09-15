import { describe, expect, it } from 'vitest';
import * as T from '../../config/thresholds';

// Invariantes entre limiares. Cada uma protege contra um ajuste manual que
// compilaria normalmente mas quebraria a lógica silenciosamente.
describe('limiares de configuração', () => {
  it('a retenção diária da EMA fica em (0, 1)', () => {
    expect(T.EMA_DAILY_RETENTION).toBeGreaterThan(0);
    expect(T.EMA_DAILY_RETENTION).toBeLessThan(1);
  });

  it('a fronteira de "progresso" fica abaixo da de "boa"', () => {
    expect(T.PROGRESS_WEEK_FRACTION_OF_TARGET).toBeLessThan(T.GOOD_WEEK_FRACTION_OF_TARGET);
    expect(T.PROGRESS_WEEK_FRACTION_OF_TARGET).toBeGreaterThan(0);
  });

  it('a janela de projeção é um intervalo válido e cabe no histórico mínimo', () => {
    expect(T.PROJECTION_WINDOW_MIN_DAYS).toBeLessThanOrEqual(T.PROJECTION_WINDOW_MAX_DAYS);
    expect(T.PROJECTION_MIN_HISTORY_DAYS).toBeLessThanOrEqual(T.PROJECTION_WINDOW_MIN_DAYS);
  });

  it('o alerta negativo exige mais de uma semana fora do plano', () => {
    // Regra central de tom do SPEC: uma semana ruim nunca vira alarme.
    expect(T.WEEKS_OUT_OF_PLAN_BEFORE_ALERT).toBeGreaterThanOrEqual(2);
  });

  it('a faixa de ruído é positiva e menor que a taxa alvo padrão', () => {
    expect(T.DEFAULT_NOISE_BAND_PCT_PER_WEEK).toBeGreaterThan(0);
    expect(T.DEFAULT_NOISE_BAND_PCT_PER_WEEK).toBeLessThan(T.DEFAULT_TARGET_RATE_PCT_PER_WEEK);
  });

  it('os dias programados padrão são seg/qua/sex e são dias da semana válidos', () => {
    expect(T.DEFAULT_SCHEDULE_DAYS).toEqual([1, 3, 5]);
    for (const d of T.DEFAULT_SCHEDULE_DAYS) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(6);
    }
  });
});
