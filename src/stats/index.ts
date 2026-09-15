/**
 * Núcleo estatístico do app.
 *
 * Todo este diretório é puro: nenhuma dependência de React, Dexie ou do DOM.
 * Recebe `WeighIn[]` e `Settings`, devolve dados. É o que permite testar as regras
 * de tom e de cálculo sem renderizar nada.
 */

export * from './types';
export * from './dates';
export * from './trend';
export * from './weekly';
export * from './rate';
export * from './dayOfWeek';
export * from './classify';
export * from './projection';
export * from './milestones';
export * from './feedback';
export * from './seed';
