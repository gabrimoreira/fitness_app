# Projeto: app de acompanhamento de peso centrado nas pesagens de seg/qua/sex

Quero construir um PWA pessoal, local-first, para acompanhar meu peso. Eu me peso toda **segunda, quarta e sexta**, e o app deve ser construído em torno desse ritual: a pesagem é o momento principal de uso e de motivação. Antes de escrever código, leia este documento inteiro, proponha um plano de implementação em fases e espere minha aprovação.

## Contexto e princípios

- Uso pessoal, um único usuário, sem backend e sem login. Todos os dados ficam no aparelho (IndexedDB).
- Uso principal no celular (instalado na tela inicial). Mobile-first.
- Interface em português do Brasil, datas no formato DD/MM, peso em kg com 1 casa decimal.
- O peso diário tem ruído de água e sódio. **Nenhuma conclusão ou aviso pode se basear em uma pesagem isolada.** Toda interpretação usa tendência suavizada ou médias semanais.
- Tom dos feedbacks: honesto e encorajador, nunca punitivo. Semanas ruins viram informação, não bronca.

## Stack

- Vite + React + TypeScript
- Dexie (IndexedDB) para persistência
- vite-plugin-pwa (manifest + service worker, funcionar offline)
- Recharts para gráficos (se algum gráfico ficar pesado ou limitado, pode propor uPlot)
- Vitest para testes
- Chamar `navigator.storage.persist()` na primeira execução

Separe a lógica estatística em um módulo puro (`src/stats/`), sem dependência de React, **com testes unitários para cada função**. É a parte que mais importa estar correta.

## Modelo de dados

```ts
interface WeighIn {
  id: string;
  date: string;          // YYYY-MM-DD (uma pesagem por dia; nova pesagem no mesmo dia substitui)
  weightKg: number;
  source: 'manual' | 'mfp-import';
  note?: string;
}

interface Settings {
  heightCm?: number;
  goalWeightKg?: number;
  targetRatePctPerWeek: number;  // perda desejada em % do peso corporal por semana, padrão 0.5
  scheduleDays: number[];         // padrão [1, 3, 5] (seg, qua, sex)
  startDate?: string;
}
```

O histórico importado pode ter datas irregulares (antes de eu adotar seg/qua/sex). Todos os cálculos precisam funcionar com intervalos irregulares.

## Métodos estatísticos (implementar exatamente assim)

1. **Tendência (EMA ajustada ao tempo):** o intervalo entre pesagens varia (2 ou 3 dias), então o fator de suavização depende do intervalo:
   `alpha = 1 - (1 - 0.1) ^ diasDesdeUltimaPesagem`
   `trend = trendAnterior + alpha * (peso - trendAnterior)`
   A tendência começa no primeiro peso registrado.
2. **Média semanal:** semana ISO de segunda a domingo. Média das pesagens da semana. A semana só é considerada "completa" com as 3 pesagens programadas; semanas com menos pesagens aparecem marcadas como parciais.
3. **Taxa semanal:** inclinação por regressão linear da tendência nos últimos 21 dias, expressa em kg/semana e em % do peso corporal/semana.
4. **Desvio por dia da semana:** para cada pesagem, `peso - trend` no mesmo dia. Agrupar a média do desvio por dia da semana (seg/qua/sex) usando as últimas 8 semanas.
5. **Rebote de fim de semana:** diferença entre a pesagem de segunda e a da sexta anterior. Guardar a série e a média móvel das últimas 8 ocorrências.
6. **Projeção para a meta:** regressão linear dos últimos 28–42 dias de tendência, com faixa de incerteza (mais/menos o erro padrão da inclinação). Não mostrar projeção com menos de 3 semanas de dados ou se a taxa não aponta para a meta.

## Classificação das semanas (base dos avisos)

Ao fechar uma semana (após a pesagem de sexta, ou na primeira abertura depois), classificar usando **a taxa da tendência**, não a diferença bruta entre médias:

- **Boa:** taxa real ≥ 75% da taxa alvo.
- **Neutra:** entre 0% e 75% da taxa alvo, ou variação dentro da faixa de ruído (definir faixa de ±0,15% do peso corporal/semana e deixar configurável).
- **Fora do plano:** tendência subindo além da faixa de ruído.

Regras dos avisos:

- Semana boa: celebrar, e destacar sequências ("3ª semana boa seguida").
- Uma única semana fora do plano: mensagem neutra e contextual, nunca alarme.
- **Alerta negativo real apenas após 2 semanas seguidas fora do plano**, com dados que ajudem a entender (ex.: rebote de fim de semana acima da média).
- Marcos: novo menor valor de tendência, cada 1 kg / 5% perdidos na tendência, meta de % atingida.

Deixe os limiares como constantes em um único arquivo de configuração, documentadas.

## Fluxo principal: registrar a pesagem

1. Tela inicial = registrar peso de hoje (teclado numérico grande, um toque para salvar). Se hoje não é dia programado, permitir mesmo assim, mas indicar.
2. **Logo após salvar, mostrar o feedback da pesagem** (esse é o momento de motivação):
   - A pesagem comparada com **o mesmo dia da semana anterior** (seg vs seg), não com a pesagem anterior.
   - Na segunda: o rebote de fim de semana deste fim de semana vs a média histórica ("+0,4 kg, abaixo do seu rebote médio de +0,6").
   - Na sexta: o fechamento da semana, com classificação e mensagem conforme as regras acima.
   - Variação da tendência e taxa semanal atual.
3. Indicador de aderência: pesagens programadas feitas na semana (●●○) e sequência de semanas completas.

## Telas de gráficos

Cada gráfico deve responder uma pergunta. Coloque essa pergunta como subtítulo do gráfico.

1. **Peso e tendência** — "Para onde estou indo?" Pontos das pesagens (discretos) + linha de tendência (forte) + linha da meta. Filtros: 4 semanas, 3 meses, 1 ano, tudo.
2. **Médias semanais** — "Como foi cada semana?" Barras da média semanal coloridas pela classificação (boa / neutra / fora do plano), com parciais em estilo tracejado ou esmaecido.
3. **Taxa semanal vs alvo** — "Estou no ritmo?" Linha da taxa (% corporal/semana) ao longo do tempo, com faixa do alvo e faixa de ruído sombreadas.
4. **Padrão da semana** — "Qual o efeito do meu fim de semana?" Desvio médio da tendência na seg, qua e sex + série do rebote sexta→segunda.
5. **Projeção** — "Quando chego na meta?" Tendência + reta projetada + faixa de incerteza + data estimada em texto.
6. **Aderência** — "Estou mantendo o ritual?" Calendário estilo heatmap mostrando dias programados com e sem pesagem.

## Importação do histórico do MyFitnessPal

Criar um script separado em `scripts/import-mfp/` (Python), que roda na minha máquina e gera um arquivo que o app importa.

- Usar a biblioteca não oficial `myfitnesspal` (`pip install myfitnesspal`), que reutiliza os cookies da minha sessão logada no navegador.
- Buscar todas as medições de peso: `client.get_measurements('Weight', data_inicio, data_fim)`, desde a data mais antiga possível até hoje. Se a chamada tiver limite de período, paginar em blocos.
- Converter unidades se vierem em libras.
- Gerar `mfp-weight-export.json` no formato `WeighIn[]` (com `source: 'mfp-import'`) e um CSV equivalente para conferência.
- Imprimir resumo: total de registros, primeira e última data, maior intervalo sem registros.
- **Plano B se a leitura de cookies falhar:** me avise o erro exato. Possíveis causas: criptografia de cookies do Chrome no Windows (tentar Firefox logado) ou mudança no site. Se a biblioteca não funcionar, me guie para inspecionar a aba Network do navegador, na página de progresso/relatórios do MyFitnessPal logado, para identificar o endpoint que retorna os dados de peso. Então escreva um snippet para eu rodar no console do navegador que baixe o JSON. **Não invente endpoints.** Investigue comigo.

No app: tela de importação que aceita o JSON/CSV, mostra pré-visualização (quantidade, período, conflitos de data) e deixa escolher entre manter ou substituir registros existentes.

## Backup

- Exportar e importar todos os dados em JSON pelo app (é o único backup, dado que o armazenamento é local).
- Mostrar a data do último backup e lembrar discretamente se passar de 30 dias.

## Fora do escopo agora (fase posterior)

- Fotos de progresso com câmera "onion skin" (sobreposição da foto anterior) e comparação antes/depois. Deixe a estrutura preparada, mas não implemente.
- Web Push. Por enquanto, feedback apenas dentro do app.

## Critérios de aceite

- Testes unitários passando para: EMA com intervalos irregulares, média semanal e semanas parciais, regressão/taxa, desvio por dia da semana, rebote, classificação de semanas (incluindo a regra de 2 semanas seguidas) e projeção.
- Um conjunto de dados sintético (seed) com ~6 meses de pesagens seg/qua/sex, ruído realista e efeito fim de semana, para eu testar os gráficos sem importar nada.
- App instalável e funcionando offline.
- Lighthouse PWA sem erros.

## Forma de trabalho

1. Proponha o plano em fases e a estrutura de pastas; espere aprovação.
2. Implemente primeiro `src/stats/` com testes e o seed.
3. Depois o fluxo de pesagem e feedback, depois os gráficos, depois importação e backup.
4. Ao terminar cada fase, faça um commit e me diga como testar.
5. Se alguma regra deste documento parecer estatisticamente errada ou gerar avisos ruins com o seed, aponte e sugira ajuste antes de seguir.