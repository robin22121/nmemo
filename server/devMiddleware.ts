import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { createClient, handleApi, type MessagesClient } from './organize';

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    size += buf.length;
    if (size > 12_000_000) throw new Error('too large');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

/** `npm run dev` / `npm run preview`에서 `/api/*`를 같은 핸들러에 연결한다. 키는 서버 환경변수에서만 읽는다. */
export function kkeujeogimApi(): Plugin {
  let client: MessagesClient | null = null;
  const middleware = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/')) return next();
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'bad_request' }));
      return;
    }
    const { status, json } = await handleApi({ method: req.method ?? 'GET', path: url.split('?')[0]!, body, client });
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(json));
  };
  return {
    name: 'kkeujeogim-api',
    configResolved(config) {
      const fileEnv = loadEnv(config.mode, config.root, '');
      client = createClient({ ...fileEnv, ...process.env });
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
