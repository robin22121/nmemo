import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { seedDemoIfEmpty } from './db/demoSeed';
import { getDb, initDb } from './db/schema';
import { getQueue } from './organize/runtime';
import './styles/global.css';

async function boot() {
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo') === '1' || import.meta.env.VITE_DEMO_DEFAULT === '1';
  const name = demo ? 'kkeujeogim-demo' : 'kkeujeogim';
  if (demo && params.get('reset') === '1') await initDb(name).delete();
  initDb(name);
  if (demo) {
    await seedDemoIfEmpty(getDb());
    // 개발·e2e용: 데모 모드에서만 DB와 대기열을 콘솔/테스트에서 만질 수 있게 둔다
    (window as unknown as { __kk?: unknown }).__kk = { db: getDb(), queue: getQueue() };
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
