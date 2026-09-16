import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/noto-sans-bengali/400.css';
import '@fontsource/noto-sans-bengali/500.css';
import '@fontsource/noto-sans-bengali/600.css';
import '@fontsource/noto-sans-bengali/700.css';
import '@fontsource/noto-sans-bengali/800.css';
import './styles/design-system.css';
import { App } from './App';

const el = document.getElementById('root');
if (!el) throw new Error('root missing');
createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Release-smoke readiness flag (read by the packaged GUI harness only).
window.addEventListener('load', () => {
  setTimeout(() => { (window as unknown as { __MERQO_READY__: boolean }).__MERQO_READY__ = true; }, 600);
});
setTimeout(() => { (window as unknown as { __MERQO_READY__: boolean }).__MERQO_READY__ = true; }, 5000);
