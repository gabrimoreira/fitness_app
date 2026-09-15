import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './ui/styles.css';

// Pede armazenamento persistente: sem isso o navegador pode descartar o IndexedDB
// sob pressão de disco, e ele é a única cópia dos dados.
if (navigator.storage?.persist) {
  void navigator.storage.persisted().then((already) => {
    if (!already) void navigator.storage.persist();
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('#root não encontrado');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
