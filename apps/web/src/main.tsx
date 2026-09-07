import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import './i18n/init';
import App from './App';
import { initWebSentry } from './lib/sentry';

// ADR-040 — DSN yoksa no-op; render'dan önce çağrılır ki erken hatalar da yakalansın.
initWebSentry();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
