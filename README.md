# 끄적임 노트

찰나의 생각·감정·사진을 아무 결정 없이 던지면, 앱이 메모의 특성을 파악해 **주제별로 모으고** 메모 사이의 **연결**을 드러내 지구본(천구)처럼 도는 보드 위에 보여 주는 모바일 우선 PWA입니다. 핵심 가치는 **연결과 창조**, 그다음 "결정 0개"와 "움직임"입니다.

- 작업 규칙·목표: [CLAUDE.md](CLAUDE.md) · 지금 상태: [STATUS.md](STATUS.md) · 확정된 결정: [docs/decisions.md](docs/decisions.md)
- 원래 설계: [docs/DESIGN.md](docs/DESIGN.md) · 작업별 설계: [docs/work-plans/](docs/work-plans/)

![보드](docs/screenshots/02-board-overview.png)

## 실행

```bash
git clone https://github.com/robin22121/nmemo.git
cd nmemo
npm install
npm run dev          # http://localhost:5173  (/api/* 도 같은 서버에서 동작)
```

- 앱을 켜면 흐린 지구본 앞에 큰 쓰기 칸이 뜹니다(+ → 녹음·사진). 저장하면 정돈된 주제로 지구본이 돌고 카드가 날아가 붙습니다. `?write=0`이면 바로 보드.
- `?demo=1` — 샘플 메모 40개(6개 주제) 데모 DB(`kkeujeogim-demo`), `&reset=1`이면 다시 채움. `?demo=big` — 주제 15개·메모 200개 성능 측정용. 데모 모드에서만 `window.__kk = { db, queue }` 노출.
- `?sheet=cover` / `?sheet=glass` — 메모장 두 안 비교(기본 glass).
- 프레임 측정: 개발 서버를 띄운 뒤 `node scripts/perf-globe.mjs [URL]`.
- 모바일에서 홈 화면에 추가(PWA)할 수 있고 오프라인에서도 열립니다.

### 스크립트

| 명령 | 내용 |
|---|---|
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint (`src/core` 경계 규칙 포함) |
| `npm test` | vitest 단위 테스트 (fake-indexeddb) |
| `npm run build` | 타입 검사 + 프로덕션 빌드(+ 서비스 워커) |
| `npm run test:e2e` | Playwright(모바일 뷰포트) + `docs/screenshots/` 갱신 |

Chromium이 `/opt/pw-browsers`에 있으면 `playwright.config.ts`가 그것을 쓰고, 아니면 `PW_CHROMIUM=/경로`로 지정합니다.

## 쓰는 법

- **쓰기**: 쓰기 칸(Enter 저장, Shift+Enter 줄바꿈) · 녹음(Web Speech `ko-KR`) · 사진(긴 변 1600px). 저장할 때 아무것도 묻지 않고 즉시 저장, 정돈은 대기열이 합니다.
- **지구본**: 좌우로 돌리면 시선이 주제 높이를 따라가고 정가운데 주제가 펼쳐집니다. 빈 곳이나 정면 이름표를 누르면 메모가 접혀 하늘 상태, 주제를 누르면 그 주제로 와서 펼쳐집니다. 주제 옆 + 는 그 주제에 쓰기.
- **메모장**: 카드를 누르면 카드 자리에서 커지며 위로 펼쳐집니다. 글 고치기, 종류·감정·완료·주제 바꾸기·삭제, 관련 메모·연결된 주제·이동 기록.
- **주제 옮기기**: 카드를 길게 눌러 오른쪽 위 주제 목록으로 끌어 놓으면 옮겨지고 고정됩니다(AI 재정리가 다시 옮기지 않음).
- **재정리**: 주제에 새 메모 5개가 쌓이고 10분이 지나면 AI가 중심을 다시 잡아 이름을 바꾸고 멀어진 메모만 옮깁니다. 한 번에 40% 이하, 고정 메모·직접 정한 이름은 그대로, 알림의 "되돌리기"로 복원.
- **움직임 줄이기**: `prefers-reduced-motion`이면 떠다니기·비행을 끄고 흐려지며 바뀝니다.

## 정돈 방식: AI 없이도, 있으면 더 똑똑하게

앱은 시작할 때 `GET /api/health`를 불러 `{ "ai": true }`이면 **RemoteAnalyzer**(서버 → Claude), 아니면 **LocalAnalyzer**(키 없이 동작하는 한국어 규칙 + 키워드 유사도)를 고릅니다. 키는 **서버 환경변수**로만 넣고 클라이언트 번들에는 들어가지 않습니다.

```bash
echo 'ANTHROPIC_API_KEY=...' > .env.local   # 저장소 루트, git에 올리지 않음
npm run dev                                  # /api/health → {"ai":true}
```

- 서버 핸들러 `server/organize.ts`(`@anthropic-ai/sdk`, 모델은 `MODEL` 상수, 도구 호출로 구조화 출력, 사진은 이미지 블록), 프롬프트·도구 스키마 `server/prompt.ts`. 새 주제 색도 AI가 주제 뜻에 맞게 고릅니다.
- 개발 서버는 Vite 플러그인(`server/devMiddleware.ts`)이, 운영은 Vercel Function(`api/[route].ts`)이 같은 핸들러를 부릅니다.
- 모델 응답은 `src/core/organize/validate.ts`에서 다시 검증(없는 id·범위 밖 값 버림, 실패하면 재시도 3번까지 지수 백오프).

## 구조

```
api/[route].ts        Vercel Function 래퍼(/api/health·organize·reorganize)
middleware.ts         Vercel Routing Middleware: 사이트 전체 Basic Auth
server/               organize.ts(핸들러), prompt.ts, devMiddleware.ts
src/core/             순수 TypeScript(React·DOM·Dexie 없음): 타입, Repo 인터페이스, actions,
                      organize/(분석기·검증·반영·대기열·재정리), layout/globe(투영·배치), connections, palette
src/db/               Dexie 스키마(v2), DexieRepo, 데모 시드
src/organize/         브라우저 어댑터: RemoteAnalyzer(fetch), 사진, 대기열 조립
src/motion/           spring 프리셋, 보드↔대기열 이벤트 통로
src/ui/globe/         지구본 보드: GlobeBoard, engine(프레임마다 투영), Composer(쓰기 칸), config
src/ui/               MemoSheet(메모장), MemoCard 얼굴, TopicListSheet, App
tests/unit, tests/e2e
```

`src/core`는 ESLint `no-restricted-imports`/`no-restricted-globals`로 react·dexie·framer-motion·브라우저 전역을 쓰지 못하게 막아 두었습니다. 저장소는 `Repo` 인터페이스로 주입합니다.

## 데이터와 배포

- 메모는 **사용자 기기 브라우저(IndexedDB)에만** 저장됩니다. 서버 저장·기기 간 동기화는 없어서 브라우저마다 따로이고, 브라우저 데이터를 지우면 사라집니다. 정돈할 때 글·사진이 Anthropic API로 전송되며 서버는 저장하지 않습니다.
- 운영: Vercel, `main`에 push하면 자동 배포(https://nmemo-five.vercel.app, 로그인 필요). 환경변수 `ANTHROPIC_API_KEY`, `APP_LOGIN_ID`, `APP_LOGIN_PASSWORD`. 배포 기록은 [docs/deploy-log.md](docs/deploy-log.md).
- 계정·동기화는 2단계 계획입니다([docs/decisions.md](docs/decisions.md) 백로그).
