import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { seedDemoIfEmpty } from './db/demoSeed';
import { getDb, initDb } from './db/schema';
import './styles/global.css';

async function boot() {
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo') === '1';
  const name = demo ? 'kkeujeogim-demo' : 'kkeujeogim';
  if (demo && params.get('reset') === '1') await initDb(name).delete();
  initDb(name);
  if (demo) await seedDemoIfEmpty(getDb());
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
