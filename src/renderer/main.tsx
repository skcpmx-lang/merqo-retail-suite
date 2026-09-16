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
