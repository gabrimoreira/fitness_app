/**
 * Imprime a classificação semana a semana do seed sintético, mais as demais
 * leituras estatísticas, para conferir o TOM do feedback antes de existir tela.
 *
 * Rode com:  npm run seed:review
 */

import { classifyWeeks, outOfPlanStreak, streakOf } from '../src/stats/classify';
import { formatDayMonth } from '../src/stats/dates';
import { deviationByDayOfWeek, weekendRebounds, reboundAverage } from '../src/stats/dayOfWeek';
import { projectToGoal } from '../src/stats/projection';
import { weeklyRate } from '../src/stats/rate';
import { generateSeed } from '../src/stats/seed';
import { computeTrend } from '../src/stats/trend';
import type { Settings } from '../src/stats/types';

const s: Settings = { targetRatePctPerWeek: 0.5, noiseBandPctPerWeek: 0.15, scheduleDays: [1,3,5], goalWeightKg: 80 };
const data = generateSeed();
const trend = computeTrend(data);
const res = classifyWeeks(data, s);

const ICON: Record<string, string> = { 'boa':'++', 'progresso':' +', 'neutra':' =', 'fora-do-plano':' !' };
console.log('semana        pesagens  media    tend    %/sem   classe         seq  ALERTA');
console.log('-'.repeat(78));
for (let i = 0; i < res.length; i++) {
  const c = res[i]!;
  const upTo = res.slice(0, i + 1);
  const alert = outOfPlanStreak(upTo) >= 2;
  const dots = '*'.repeat(c.week.scheduledMet) + 'o'.repeat(c.week.scheduledCount - c.week.scheduledMet);
  const label = `${formatDayMonth(c.week.weekStart)}-${formatDayMonth(c.week.weekEnd)}`;
  if (c.klass === null) {
    console.log(`${label}   ${dots}      ${(c.week.averageKg?.toFixed(1) ?? '  - ').padStart(5)}    ${(c.week.trendAtEnd?.toFixed(1) ?? ' - ').padStart(5)}      -   [${c.reason}]`);
    continue;
  }
  const seq = streakOf(upTo, c.klass);
  console.log(`${label}   ${dots}      ${c.week.averageKg!.toFixed(1)}    ${c.week.trendAtEnd!.toFixed(1)}   ${c.pctPerWeek!.toFixed(2).padStart(6)}  ${ICON[c.klass]} ${c.klass.padEnd(13)} ${seq}   ${alert ? '<<< ALERTA' : ''}${c.demotedByAverage ? ' (guarda)' : ''}`);
}

const end = data[data.length - 1]!.date;
console.log('\n--- outras leituras no fim do periodo ---');
const r = weeklyRate(trend, end)!;
console.log(`taxa 21d:     ${r.kgPerWeek.toFixed(2)} kg/sem  (${r.pctPerWeek.toFixed(2)} %/sem)`);
console.log(`peso inicial: ${trend[0]!.trendKg.toFixed(1)} kg   ->  atual ${trend[trend.length-1]!.trendKg.toFixed(1)} kg`);
console.log('desvio por dia: ' + deviationByDayOfWeek(data, end, 8).map(d => `${d.label} ${d.meanDeviationKg>=0?'+':''}${d.meanDeviationKg.toFixed(2)}`).join('   '));
const reb = weekendRebounds(data);
console.log(`rebote medio (ult. 8): +${reboundAverage(reb)!.toFixed(2)} kg   (${reb.length} ocorrencias)`);
const proj = projectToGoal(data, trend, 80, end);
console.log('projecao:     ' + (proj.available ? `${proj.estimatedDate} (faixa ${proj.earliestDate} a ${proj.latestDate})` : `nao exibida [${proj.reason}]`));
