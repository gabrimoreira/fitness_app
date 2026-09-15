/**
 * Todas as constantes de ajuste do app em um único lugar.
 *
 * CONVENÇÃO DE SINAL (vale para o projeto inteiro):
 *   Taxas de variação de peso são ASSINADAS e negativo = perda.
 *   Uma taxa de -0.5 %/semana é uma perda de meio por cento do peso corporal por semana.
 *   A exceção é `Settings.targetRatePctPerWeek`, guardado POSITIVO como a magnitude
 *   da perda desejada (é o que o usuário digita). Converta com `targetRateSigned()`.
 */

// ---------------------------------------------------------------------------
// Tendência (EMA ajustada ao tempo)
// ---------------------------------------------------------------------------

/**
 * Fator de retenção diário da EMA. O alpha efetivo de cada pesagem é
 * `1 - EMA_DAILY_RETENTION ^ diasDesdeUltimaPesagem`, de modo que intervalos
 * irregulares (2 ou 3 dias, ou lacunas longas do histórico importado) pesem
 * proporcionalmente. Valor definido no SPEC.
 *
 * 0.9 dá meia-vida de ~6.6 dias: alpha 0.19 num intervalo de 2 dias, 0.271 em 3 dias.
 */
export const EMA_DAILY_RETENTION = 0.9;

// ---------------------------------------------------------------------------
// Taxa semanal
// ---------------------------------------------------------------------------

/**
 * Janela da regressão linear que produz a "taxa semanal atual" mostrada no
 * feedback da pesagem e no gráfico 3. NÃO é usada para classificar semanas —
 * ver `classify.ts` e a nota sobre sobreposição de janelas.
 */
export const RATE_WINDOW_DAYS = 21;

/** Mínimo de pontos de tendência na janela para a taxa ser considerada calculável. */
export const RATE_MIN_POINTS = 4;

// ---------------------------------------------------------------------------
// Classificação das semanas
// ---------------------------------------------------------------------------

/**
 * Faixa de ruído, em % do peso corporal por semana. Variação da tendência dentro
 * de ±este valor é tratada como indistinguível de zero (água, sódio, horário).
 * Configurável pelo usuário em Settings; este é o padrão.
 */
export const DEFAULT_NOISE_BAND_PCT_PER_WEEK = 0.15;

/** Padrão de perda desejada, em % do peso corporal por semana (magnitude positiva). */
export const DEFAULT_TARGET_RATE_PCT_PER_WEEK = 0.5;

/**
 * Fronteiras das 4 faixas de classificação, como fração da taxa alvo.
 *
 * Com alvo 0.5 %/sem:  boa >= 0.375  |  progresso >= 0.20  |  neutra > 0  |  fora do plano
 *
 * A faixa `progresso` não está no SPEC original: foi adicionada porque a fronteira
 * única de 75% jogava uma semana de perda real e saudável (0.30 %/sem) na mesma
 * categoria de um platô, o que lê como punitivo ao longo dos meses. Sequências e o
 * alerta de duas semanas continuam olhando SOMENTE `fora-do-plano`.
 */
export const GOOD_WEEK_FRACTION_OF_TARGET = 0.75;
export const PROGRESS_WEEK_FRACTION_OF_TARGET = 0.40;

/**
 * Número de semanas consecutivas classificadas como `fora-do-plano` necessárias
 * para emitir um alerta negativo. Uma única semana fora do plano recebe apenas
 * mensagem neutra e contextual. Regra explícita do SPEC.
 */
export const WEEKS_OUT_OF_PLAN_BEFORE_ALERT = 2;

// ---------------------------------------------------------------------------
// Desvio por dia da semana e rebote
// ---------------------------------------------------------------------------

/** Janela de análise do desvio médio por dia da semana (gráfico 4). */
export const DAY_OF_WEEK_WINDOW_WEEKS = 8;

/** Quantas ocorrências de rebote sexta->segunda entram na média móvel. */
export const REBOUND_MOVING_AVERAGE_COUNT = 8;

/**
 * Intervalo exato, em dias, entre a sexta e a segunda de um par de rebote.
 * Pares fora disso são descartados (feriado, pesagem em sábado do histórico
 * importado, etc.) para não misturar janelas de tamanhos diferentes.
 */
export const REBOUND_EXPECTED_GAP_DAYS = 3;

// ---------------------------------------------------------------------------
// Projeção para a meta
// ---------------------------------------------------------------------------

/** Janela da regressão de projeção (gráfico 5). O SPEC pede 28 a 42 dias. */
export const PROJECTION_WINDOW_MIN_DAYS = 28;
export const PROJECTION_WINDOW_MAX_DAYS = 42;

/** Sem pelo menos isto de histórico não existe projeção nenhuma. Regra do SPEC. */
export const PROJECTION_MIN_HISTORY_DAYS = 21;

/**
 * Projeções além deste horizonte não são exibidas. Uma inclinação quase nula
 * produz matematicamente uma data a décadas de distância: é um número sem
 * significado, e mostrá-lo seria pior do que não mostrar nada.
 */
export const PROJECTION_MAX_HORIZON_DAYS = 730;

/**
 * Multiplicador do erro padrão que forma a faixa de incerteza (~95%).
 *
 * IMPORTANTE: a faixa é derivada da dispersão das PESAGENS BRUTAS em torno da reta
 * ajustada, não dos resíduos da própria tendência. Os pontos da tendência são
 * fortemente autocorrelacionados — a EMA os constrói uns a partir dos outros — e o
 * erro padrão OLS calculado sobre eles subestima a incerteza real em cerca de uma
 * ordem de grandeza, produzindo uma faixa de poucos dias numa projeção de meses.
 */
export const PROJECTION_CONFIDENCE_MULTIPLIER = 1.96;

// ---------------------------------------------------------------------------
// Marcos
// ---------------------------------------------------------------------------

/** Marco a cada N kg perdidos na tendência, contados a partir do peso inicial. */
export const MILESTONE_EVERY_KG = 1;

/** Marco a cada N % do peso inicial perdidos na tendência. */
export const MILESTONE_EVERY_PCT = 5;

/**
 * Histerese dos marcos, em kg. Um marco já atingido só é "desfeito" (voltando a
 * poder disparar) se a tendência subir este tanto acima do limiar. Sem isso, uma
 * tendência oscilando em torno de um patamar dispararia a mesma celebração
 * repetidamente.
 */
export const MILESTONE_HYSTERESIS_KG = 0.3;

// ---------------------------------------------------------------------------
// Ritual e aderência
// ---------------------------------------------------------------------------

/** Dias programados de pesagem: 1=segunda ... 5=sexta (0=domingo). Padrão seg/qua/sex. */
export const DEFAULT_SCHEDULE_DAYS = [1, 3, 5];

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

/**
 * Dias desde o último backup antes de lembrar o usuário. O armazenamento é local
 * e este export é o único backup existente.
 */
export const BACKUP_REMINDER_AFTER_DAYS = 30;

/**
 * Intervalo máximo, em dias, entre os dois pontos de tendência que definem o delta
 * de uma semana. Acima disso a semana fica sem classificação em vez de receber uma
 * duvidosa: normalizar para "por semana" um delta medido ao longo de dois meses
 * descreve outra coisa, e depois de uma lacuna longa a própria EMA reiniciou no
 * peso novo (alpha tende a 1), então o delta mede o degrau da lacuna e não o ritmo.
 * 14 dias tolera uma semana perdida inteira.
 */
export const MAX_WEEK_COMPARISON_GAP_DAYS = 14;

/**
 * Dias de tendência acumulada necessários antes de classificar uma semana.
 *
 * A EMA começa no primeiro peso registrado (regra do SPEC) e leva algumas semanas
 * para acumular o atraso de regime. Antes disso o delta da tendência subestima o
 * ritmo real de forma previsível — medido numa rampa linear exatamente no alvo de
 * 0,5%/semana: 60% do valor verdadeiro na 1ª semana, 81% na 2ª, 92% na 3ª, 97% na
 * 4ª. Classificar nesse período diria "progresso" a quem está exatamente no alvo.
 *
 * Vale tanto para quem começa do zero quanto para quem volta depois de uma lacuna
 * longa, que reinicia a tendência no peso novo.
 *
 * É a mesma postura que o SPEC já adota para a projeção, que não aparece com menos
 * de três semanas de dados: sem base suficiente, não afirmar nada.
 */
export const CLASSIFICATION_WARMUP_DAYS = 21;
