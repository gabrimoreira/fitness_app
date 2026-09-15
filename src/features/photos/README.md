# Fotos de progresso — não implementado

Fora do escopo atual por decisão do SPEC. A pasta existe para marcar o ponto de
extensão e para que a decisão fique registrada junto do código, não só no SPEC.

Quando for implementado, o previsto é:

- captura com câmera em modo "onion skin" (sobreposição semitransparente da foto anterior
  para alinhar o enquadramento);
- comparação antes/depois;
- blobs guardados no próprio IndexedDB, numa tabela `photos` separada de `weighIns`.

Implicações a considerar antes de começar:

- **Backup.** O export JSON atual é a única cópia dos dados. Fotos são grandes demais para
  caber nele confortavelmente; vai precisar de um formato de export separado (ZIP) ou de
  export de fotos à parte.
- **Cota de armazenamento.** `navigator.storage.persist()` já é chamado no boot, mas fotos
  mudam a ordem de grandeza do uso de disco e valeria mostrar o consumo ao usuário.
