// Vercel Function 래퍼. 로직은 server/organize.ts 의 handleApi 를 그대로 쓴다. 키는 서버 환경변수에서만 읽는다.
import { createClient, handleApi } from '../server/organize.ts';

async function handle(request: Request): Promise<Response> {
  let body: unknown;
  if (request.method === 'POST') {
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : undefined;
    } catch {
      return Response.json({ error: 'bad_request' }, { status: 400 });
    }
  }
  const { status, json } = await handleApi({
    method: request.method,
    path: new URL(request.url).pathname,
    body,
    client: createClient(process.env),
  });
  return Response.json(json, { status });
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
