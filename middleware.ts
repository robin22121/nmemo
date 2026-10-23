// Vercel Routing Middleware: `/api/*`만 HTTP Basic Auth로 보호한다. 앱 화면 파일은 공개(서비스 워커가 새 버전을 받을 수 있게).
// 앱이 401을 받으면 앱 안 로그인 칸으로 묻고 `Authorization` 헤더로 보낸다.
// 로컬 `npm run dev`(Vite)에서는 실행되지 않는다.
export const config = { matcher: ['/api/:path*'] };

const enc = new TextEncoder();

function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export default function middleware(request: Request): Response {
  const id = process.env.APP_LOGIN_ID;
  const pw = process.env.APP_LOGIN_PASSWORD;
  const header = request.headers.get('authorization') ?? '';
  if (id && pw && header.startsWith('Basic ')) {
    try {
      const decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));
      const i = decoded.indexOf(':');
      if (i >= 0 && safeEqual(decoded.slice(0, i), id) && safeEqual(decoded.slice(i + 1), pw)) {
        // @vercel/functions next()와 동일: 요청을 그대로 통과시킨다.
        return new Response(null, { headers: { 'x-middleware-next': '1' } });
      }
    } catch {
      // 잘못된 base64 -> 401
    }
  }
  // WWW-Authenticate를 보내지 않는다: 브라우저 기본 로그인 창 대신 앱이 묻는다
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}
