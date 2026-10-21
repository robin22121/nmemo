# 끄적임 노트 — 구현 설계 (v1)

원본 설계서(사람용): https://claude.ai/artifact/1Fm7EUW5hRpdBDmDAbBH9P
앱 컨셉: https://claude.ai/artifact/V3jW6fjrtknukejHayBXo8

이 파일은 구현자가 그대로 따라 만들 수 있도록 쓴 기술 명세다. 설계와 다르게 해야 할 이유가 생기면 코드에 맞추지 말고 이 파일에 "결정 기록"으로 남긴다.

## 1. 제품 한 줄

찰나의 생각·감정·사진을 아무렇게나 던지면, 앱이 메모의 특성을 파악해 **주제별로 분류**하고 **상관관계**를 분석해서, 보드 위에 **주제 무리(cluster)로 흩어진 듯 모여 있게** 보여준다. 트리/폴더 구조가 아니다. **애니메이션이 핵심**이다.

## 2. v1 범위

포함: 3버튼 입력(글·녹음·사진), 정돈 파이프라인(특성 파악 → 주제 분류 → 상관관계), 주제 무리 보드, 애니메이션 8장면, 끌어서 주제 바꾸기, 관련 메모 띄우기, 무리 상세, 메모 상세.
제외(2차): 충돌 카드, 관점 렌즈, 반대 의견, 알림, 로그인·동기화.

## 3. 스택과 위치

- 위치: 저장소 루트의 `kkeujeogim/` 폴더. 루트의 기존 imghosting 파일(`public/`, `firebase.json` 등)은 수정하지 않는다.
- Vite + React 18 + TypeScript(strict). 패키지 매니저 npm.
- PWA: `vite-plugin-pwa` (manifest, 오프라인 캐시, 홈 화면 설치). 앱 이름 "끄적임 노트", 짧은 이름 "끄적임".
- 애니메이션: `framer-motion`.
- 무리 배치: `d3-force` (필요한 모듈만).
- 저장: `dexie` (IndexedDB). React 연동은 `dexie-react-hooks`의 `useLiveQuery`.
- 상태: React state + Dexie live query로 충분. 전역 상태 라이브러리는 꼭 필요할 때만(zustand 허용).
- 테스트: `vitest` (+ `fake-indexeddb`), 브라우저 스모크는 `@playwright/test` (Chromium은 `/opt/pw-browsers`에 설치되어 있음, `playwright install` 금지).
- 스타일: 일반 CSS 또는 CSS Modules. UI 프레임워크(MUI 등) 쓰지 않는다. 모바일 우선(375px 폭 기준), 데스크톱에서도 동작.

## 4. 데이터 모델 (`src/db/`)

```ts
type InputType = 'text' | 'voice' | 'photo';
type MemoKind = 'idea' | 'emotion' | 'observation' | 'todo';
type MemoStatus = 'pending' | 'organized' | 'failed';

interface Memo {
  id: string;            // crypto.randomUUID()
  createdAt: number;     // ms
  input: InputType;
  text: string;          // 녹음은 받아적은 글, 사진은 분석 후 채워지는 설명(사용자 캡션이 있으면 그것)
  photo?: Blob;          // 사진 원본(긴 변 1600px로 줄여 JPEG 저장)
  kind?: MemoKind;
  emotion?: { label: string; color: string }; // color: #rrggbb
  keywords?: string[];
  summary?: string;      // 한 줄 요약
  topicId?: string;
  topicLocked: boolean;  // 사용자가 직접 주제를 정했으면 true → 재분류 금지
  status: MemoStatus;
  attempts: number;      // 정돈 시도 횟수
}

interface Topic {
  id: string;
  name: string;          // 짧은 이름 (예: "동네 카페")
  summary: string;       // 한 줄 설명
  color: string;         // 무리 색, 팔레트에서 배정
  createdAt: number;
}

interface Link {
  id: string;            // `${a}|${b}` (a<b 정렬)로 중복 방지
  fromId: string;
  toId: string;
  strength: number;      // 0~1
  reason: string;        // 왜 관련 있는지 한 줄
}
```

Dexie 스키마 v1: `memos: 'id, createdAt, status, topicId'`, `topics: 'id, createdAt'`, `links: 'id, fromId, toId'`.
주제는 평평한 목록이다. 부모/자식 필드를 만들지 않는다. 메모가 하나도 없는 주제는 자동 삭제한다.

## 5. 정돈 파이프라인 (`src/organize/`)

### 흐름
1. 저장: 입력 즉시 `status='pending'`으로 저장 → 보드 대기 자리에 표시. 사용자를 기다리게 하지 않는다.
2. 대기열(`queue.ts`): pending/failed(attempts<3) 메모를 오래된 순으로 **한 번에 하나씩** 처리. 앱 시작 시, 새 메모 저장 시, 온라인 복귀 시 깨운다. 실패하면 attempts+1, status='failed', 지수 백오프.
3. 분석기 호출: `Analyzer` 인터페이스 하나로 추상화.
4. 반영: 한 트랜잭션에서 메모 갱신(kind/emotion/keywords/summary/topicId/status='organized'), 새 주제 생성, 링크 upsert. topicLocked 메모는 topicId를 덮어쓰지 않는다(특성·링크는 갱신).

### Analyzer 인터페이스
```ts
interface AnalyzeRequest {
  memo: { id: string; input: InputType; text: string; photoBase64?: string; photoMime?: string };
  topics: { id: string; name: string; summary: string }[];             // 기존 주제 전부(최대 60)
  recent: { id: string; summary: string; topicId?: string }[];         // 최근 정돈된 메모 요약(최대 80)
}
interface AnalyzeResult {
  kind: MemoKind;
  emotion: { label: string; color: string };
  keywords: string[];                       // 1~5개
  summary: string;                          // 40자 이내
  text?: string;                            // 사진 메모일 때 장면·글자·분위기 설명
  topic: { existingId: string } | { newName: string; newSummary: string };
  related: { id: string; strength: number; reason: string }[];   // 최대 5개, strength 0~1
}
interface Analyzer { analyze(req: AnalyzeRequest): Promise<AnalyzeResult> }
```
결과 검증: id가 실제 목록에 있는지, strength 범위, kind 값 등을 런타임 검증(zod 허용). 잘못된 항목은 버리고, topic이 엉망이면 실패로 처리.

### 구현 두 가지
- `RemoteAnalyzer`: `POST /api/organize`에 AnalyzeRequest를 보내고 AnalyzeResult를 받는다.
- `LocalAnalyzer`: 키 없이 동작하는 간이 분석기. 한국어 텍스트에서 키워드 추출(조사 제거 수준의 간단한 규칙 + 불용어), 기존 주제/최근 메모와 키워드 자카드 유사도로 주제 배정(임계값 미만이면 상위 키워드로 새 주제), 관련 메모는 유사도 상위 5개. kind는 규칙(할 일: "해야", "하기", "사기", 체크 표현 / 감정: 감정 어휘 사전 / 사진: observation / 나머지 idea). 감정은 작은 사전으로 label+color.
- 선택: 앱 시작 시 `GET /api/health`가 `{ai:true}`면 Remote, 아니면 Local. 설정 화면 없이 자동.

### 서버 프록시 (`server/`)
- 핸들러 `server/organize.ts`: AnalyzeRequest → Claude Messages API 호출 → AnalyzeResult. `ANTHROPIC_API_KEY` 환경변수에서 키를 읽는다. 키는 절대 클라이언트 번들에 들어가지 않는다.
- 모델: `claude-haiku-5-5`. 공식 SDK `@anthropic-ai/sdk` 사용. 구조화된 출력은 tool use(입력 스키마 = AnalyzeResult)로 강제한다. 사진은 image content block(base64)으로 보낸다.
- 시스템 프롬프트 요지(한국어): "너는 짧은 메모를 정돈하는 도우미다. 메모의 특성(종류·감정·키워드·요약)을 파악하고, 기존 주제 중 가장 맞는 것을 고르거나 정말 새로운 경우에만 짧은 새 주제를 만든다. 주제는 상하 관계 없이 평평하다. 관련 메모는 실제로 내용·감정·맥락이 이어지는 것만, 최대 5개." 주제가 과도하게 쪼개지지 않도록 "가능하면 기존 주제 재사용"을 강조.
- 개발: Vite 플러그인 미들웨어로 `/api/*`를 같은 핸들러에 연결(`npm run dev`에서 바로 동작).
- 배포: `functions/`에 Firebase Cloud Functions(2세대, Node 22) 래퍼를 두되, 루트 `firebase.json`은 수정하지 않는다. 배포 연결은 2차 작업으로 README에 적는다.

### 5.1 주제 재구성 (`src/organize/reorganize.ts`)

주제는 고정되지 않는다. 무리의 중심이 바뀌면 주제 이름이 바뀌고, 더는 맞지 않는 메모는 다른 무리로 옮긴다.
예: '마라톤' 무리에 황영조·마라톤화·가민이 있다가 용품 메모가 늘어 주제가 '운동용품'이 되면, 황영조는 더 맞는 무리(없으면 새 주제)로 빠진다.

데이터 추가:
```ts
interface Topic { /* 기존 필드 + */
  centerKeywords: string[]; // 무리의 중심 키워드
  nameLocked: boolean;      // 사용자가 이름을 직접 정함 → AI가 이름을 바꾸지 않음, 이 이름을 중심으로 삼음
  lastReorgAt: number;
  sinceReorg: number;       // 마지막 재구성 뒤 들어온 메모 수
}
interface Move { id: string; batchId: string; memoId: string; fromTopicId: string; toTopicId: string; reason: string; at: number }
```
Dexie 스키마 v2로 올리고(`moves: 'id, batchId, memoId, at'`), 기존 주제에 기본값 채우는 upgrade 함수 작성.

트리거: 주제에 메모가 들어올 때 sinceReorg+1 → 5 이상이면 재구성 대기열에 올림. 사용자가 주제 이름을 바꾸면 즉시(nameLocked=true). 같은 주제는 10분에 한 번만(이름 변경 트리거는 예외). 정돈 대기열과 같은 큐에서 정돈 작업 뒤에 처리.

분석기 인터페이스 확장:
```ts
interface ReorganizeRequest {
  topic: { id: string; name: string; summary: string; nameLocked: boolean };
  members: { id: string; summary: string; keywords: string[]; locked: boolean }[]; // 그 주제의 메모 전부(최대 80)
  otherTopics: { id: string; name: string; summary: string; centerKeywords: string[] }[];
}
interface ReorganizeResult {
  topic: { name: string; summary: string; centerKeywords: string[] }; // nameLocked면 name은 무시
  moves: { memoId: string; to: { existingId: string } | { newName: string; newSummary: string }; fit: number; reason: string }[];
}
interface Analyzer { analyze(...); reorganize(req: ReorganizeRequest): Promise<ReorganizeResult> }
```
- Remote: `POST /api/reorganize`, 같은 모델·tool use 방식. 프롬프트: "무리 전체를 보고 지금의 중심 주제를 다시 정하고, 새 중심에서 멀어진 메모만 골라 더 맞는 기존 주제나 새 주제로 보낸다. 확실하지 않으면 옮기지 않는다."
- Local: 멤버 키워드 빈도 상위로 centerKeywords·이름 갱신(nameLocked면 이름 유지하고 이름을 키워드에 포함). 메모별로 현재 중심과의 유사도 vs 다른 주제 중심과의 유사도 비교.
- 흔들림 방지(적용 단계에서 강제, 분석기 결과를 그대로 믿지 않음): locked 메모 제외, `fit` 0.6 미만은 버림, Local은 다른 주제 유사도가 현재보다 0.15 이상 높을 때만, 한 번에 무리의 40% 넘게 빠지지 않게(넘으면 fit 높은 순으로 자름). 옮긴 메모는 30분 동안 다시 옮기지 않음.
- 적용: 한 트랜잭션에서 주제 갱신 + 메모 topicId 변경 + Move 기록(같은 batchId) + 빈 주제 삭제.
- 알림: 보드 하단 토스트 6초 — "'마라톤'이 '운동용품'이 되면서 메모 1개가 '인물'로 옮겨졌어요 · 되돌리기". 되돌리기 = 그 batchId의 Move를 역으로 적용하고 이름도 복원(복원용으로 이전 이름·요약을 batch에 함께 저장), 되돌린 메모는 topicLocked=true.
- 테스트: 마라톤 예시 그대로 LocalAnalyzer 단위 테스트(황영조만 빠지고 마라톤화·가민은 남음), locked 메모 유지, 40% 상한, 되돌리기.

## 6. 화면 (`src/ui/`)

- **보드**(시작 화면): 전체 화면 캔버스. 두 손가락 확대/이동(데스크톱은 휠/드래그). 주제 무리가 여기저기 흩어져 있고, 각 무리는 이름 라벨 + 옹기종기 모인 카드들. 무리 배경은 주제 색의 아주 옅은 번짐(radial-gradient, blur)으로 경계를 암시만 한다(테두리 박스 금지).
- **대기 자리**: 화면 아래쪽, 입력 바 바로 위의 작은 영역. pending 카드가 머문다.
- **입력 바**(하단 고정): 버튼 3개.
  - 쓰기: 한 줄 입력창이 위로 펼쳐짐, Enter로 저장, 여러 줄 허용(Shift+Enter).
  - 녹음: 길게 누르는 동안 Web Speech API(`ko-KR`)로 받아적기, 떼면 저장. 지원 안 되는 브라우저에선 버튼을 눌렀을 때 "이 브라우저는 음성 입력을 지원하지 않아요" 안내 후 쓰기 창으로 전환.
  - 사진: `<input type=file accept=image/* capture=environment>`. 긴 변 1600px로 줄여 저장.
  - 저장 시 제목·폴더·태그를 묻지 않는다(결정 0개).
- **카드 모양**(종류별): idea=포스트잇(살짝 기울어진 노란 계열 종이), emotion=감정 색의 부드러운 색 번짐 원형, photo=둥근 썸네일 + 한 줄, todo=체크 박스가 있는 카드(체크 가능, 체크 상태는 Memo에 `done?: boolean` 추가 허용). pending은 회색 점선 카드. 카드 텍스트는 summary(없으면 text 앞부분) 최대 2줄.
- **무리 상세**: 무리를 탭하면 그 무리가 확대되며 카드가 넓게 펼쳐진다. 주제 이름 탭해서 고치기. 뒤로 가면 다시 접힘.
- **메모 상세**: 카드 탭(길게 누르기 아님) → 바텀 시트. 원본(글/사진), 감정, 키워드, 관련 메모 목록(이유 포함, 탭하면 그 메모로 이동), 주제 바꾸기(주제 목록 + 새 주제), 삭제.
- **관련 메모 강조**: 보드에서 카드를 누르고 있는 동안(또는 상세가 열려 있는 동안) 관련 메모가 빛나고 가는 곡선으로 이어진다. 나머지는 흐려진다.
- **주제 바꾸기 제스처**: 카드를 길게 눌러 들어 올린 뒤 다른 무리 위에 놓으면 그 주제로 이동(topicLocked=true). 빈 곳에 놓으면 "새 주제 만들기" 확인.
- 빈 상태: 메모가 없으면 보드 가운데 "떠오르는 걸 아무렇게나 던져보세요" 한 줄.
- 개발용: `?demo=1`이면 샘플 메모 40개(5~6개 주제, 네 가지 종류 고르게)를 넣은 데모 DB로 시작.

## 7. 무리 배치 알고리즘 (`src/layout/`)

목표: **흩어진 듯 모여 있는** 느낌. 격자·트리·원형 정렬 금지.
- 2단계 force 시뮬레이션:
  1. 무리 중심: 주제마다 노드 1개, 반지름 = 카드 수에 비례(√n). `forceManyBody`(약한 반발) + `forceCollide`(반지름+여백) + 약한 `forceX/forceY`(중앙으로). 주제 간 링크가 많을수록 가까이(주제 쌍별 링크 강도 합으로 `forceLink`).
  2. 카드: 각 카드는 자기 무리 중심으로 당기는 force + `forceCollide`(카드 크기) + 같은 무리 안 관련 카드끼리 약한 링크. 초기 위치는 무리 중심 근처 시드 고정 난수(메모 id 해시)로 → 다시 열어도 비슷한 모양.
- 결정성: 같은 데이터면 같은 배치(시드 난수, 고정 tick 수로 미리 계산 후 렌더). 새 메모가 들어오면 기존 위치에서 이어서 몇십 tick만 다시 돌려 **기존 카드는 조금만 움직이게** 한다.
- 성능: 카드 200개에서 레이아웃 계산 < 50ms 목표. 계산은 렌더 루프 밖에서. 필요하면 Web Worker.
- 좌표는 월드 좌표, 보드 뷰포트(확대/이동)는 CSS transform 하나로.

## 8. 애니메이션 (`src/motion/`) — 가장 중요

전부 spring 기본(`type:'spring'`, stiffness 180~320, damping 18~26 범위에서 조정). 카드 위치는 transform만 애니메이션(top/left 금지).

| 장면 | 움직임 | 구현 힌트 |
|---|---|---|
| 메모 저장 | 입력 바에서 카드가 톡 떠올라 대기 자리로 | `layoutId`를 입력 바 미리보기 → 대기 카드에 공유 |
| 정돈 중 | 대기 카드가 숨쉬듯 천천히 커졌다 작아짐 (scale 1↔1.04, 2.4s) | 반복 keyframes |
| 정돈 완료 | 카드가 포물선을 그리며 제 무리로 날아가 붙고, 무리가 살짝 출렁 | 대기 위치→목표 위치를 중간 제어점이 위로 솟은 경로로(키프레임 x/y 3점), 도착 시 무리 scale 1→1.03→1 |
| 새 주제 생김 | 빈 자리에서 무리가 피어나고(scale 0→1, opacity) 주변 무리들이 비켜줌 | 레이아웃 재계산 결과로 이웃 무리 spring 이동 |
| 평소 | 카드가 아주 느리게 떠다님 (±2~3px, 6~10s 주기, 카드마다 위상 다르게) | CSS animation 권장(성능), 드래그·전환 중엔 정지 |
| 카드 누르기 | 관련 카드가 2~6px 끌려오며 빛나고, 가는 곡선으로 연결 / 나머지 opacity 0.35 | SVG path `pathLength` 0→1 그리기 |
| 카드 끌기 | 카드가 손가락을 따라오고(약간 커지고 그림자), 다른 무리 위에선 그 무리가 부풀어 받아줄 준비, 놓으면 흡수 | framer `drag` + 히트 테스트 |
| 무리 열기 | 무리가 확대되며 카드가 펼쳐짐, 닫으면 다시 모임 | 공유 `layoutId` 전환 |
| 주제 재구성 | 무리 이름이 스르륵 바뀌고(크로스페이드), 맞지 않는 카드가 무리에서 떨어져 나와 새 무리로 날아감, 남은 카드는 빈자리를 메우며 다시 모임 | 이름 크로스페이드 → 카드마다 80ms 시차로 출발(포물선) → d3-force 재계산 결과로 나머지 spring 이동. 되돌리기는 같은 동작의 역재생 |

- `prefers-reduced-motion: reduce`이면: 떠다니기·출렁임·포물선 끔, 위치 변경은 짧은 opacity 크로스페이드.
- 목표: 카드 200개, 중급 안드로이드에서 끊김 없이(60fps 근처). 떠다니기는 화면 밖 카드에선 끈다.

## 8.1 React Native 이전 대비

v1은 PWA지만, 나중에 React Native로 옮길 수 있다. 그래서 `src/core/`(아래 db 제외 로직: organize, reorganize, layout, types, validate)는 **React·DOM·브라우저 API를 import하지 않는 순수 TypeScript**로 작성한다. 저장소 접근은 `Repo` 인터페이스로 주입하고 Dexie 구현은 `src/db/`에 둔다. 화면(`src/ui/`)과 애니메이션(`src/motion/`)만 플랫폼에 묶인다. ESLint `no-restricted-imports`로 core가 react/dexie/framer-motion을 import하지 못하게 막는다.

## 9. 폴더 구조(권장)

```
kkeujeogim/
  docs/DESIGN.md
  index.html
  package.json
  vite.config.ts
  server/            organize.ts, prompt.ts, devMiddleware.ts
  functions/         Firebase Functions 래퍼 (배포 연결은 2차)
  src/
    main.tsx, App.tsx
    db/              schema.ts, repo.ts, demoSeed.ts
    organize/        types.ts, queue.ts, remote.ts, local.ts, validate.ts, apply.ts
    layout/          clusters.ts (d3-force), seededRandom.ts
    motion/          presets.ts
    ui/              Board, Cluster, MemoCard(종류별), InputBar, PendingTray, MemoSheet, ClusterView, RelatedLines
    styles/
  tests/             unit(vitest), e2e(playwright)
  README.md          실행법, 환경변수, 배포 메모
```

## 10. 구현 순서와 완료 기준

각 단계 끝에서 `npm run typecheck && npm run lint && npm test && npm run build`가 통과해야 한다. 단계마다 커밋한다.

1. 뼈대: Vite+React+TS, PWA, ESLint, Vitest, Dexie 스키마, 빈 보드.
2. 입력: 3버튼, 저장, 대기 자리 표시. (테스트: 저장 시 pending 메모 생성)
3. 정돈: Analyzer 인터페이스, LocalAnalyzer, RemoteAnalyzer, 서버 핸들러, 대기열, 반영 트랜잭션, 결과 검증. (테스트: LocalAnalyzer가 비슷한 메모를 같은 주제로 묶음, 잘못된 AI 응답을 거름, topicLocked 존중, 빈 주제 삭제)
4. 보드: d3-force 2단계 배치, 종류별 카드, 확대/이동, 데모 데이터. (테스트: 같은 입력 → 같은 배치, 무리끼리 겹치지 않음)
5. 애니메이션: 8장면 + reduced motion.
6. 고치기·상세: 끌어서 주제 바꾸기, 무리 상세, 메모 상세, 관련 메모 강조.
7. 점검: Playwright 스모크(데모 모드 열기 → 글 메모 저장 → 정돈되어 무리에 붙음 확인, 모바일 뷰포트 375×812), 스크린샷 몇 장을 `kkeujeogim/docs/screenshots/`에 저장, README 작성.

## 11. 결정 기록

- (구현 중 설계와 달라진 점을 여기에 적는다.)
- **core 분리(8.1)**: 순수 로직은 `src/core/`(types, repo 인터페이스, actions, palette, organize/{types,validate,local,apply,queue,reorganize}, 이후 layout)에 둔다. §9의 `src/organize/`에는 브라우저 어댑터만 남긴다(`remote.ts`=fetch, `photo.ts`=Blob→base64, `runtime.ts`=대기열 조립). `src/db/`는 Dexie 스키마와 `DexieRepo`(Repo 구현), UI용 얇은 래퍼 `repo.ts`. ESLint가 core의 react/dexie/framer-motion import와 브라우저 전역(window, document, fetch 등) 사용을 막는다. 사진은 `PhotoReader`, 온라인 신호는 `onWakeSignal`로 주입한다.
- **moves 외에 `batches` 테이블 추가(Dexie v2)**: 5.1은 "복원용 이전 이름·요약을 batch에 저장"이라고 했지만 테이블 목록에 batch가 없어, `batches: 'id, topicId, at'`를 함께 만들었다(이름만 바뀌고 메모가 안 옮겨진 재구성도 되돌릴 수 있게).
- **사용자 이름 변경 → 즉시 재구성**: `renameTopic`이 `nameLocked=true, lastReorgAt=0, sinceReorg=99`를 써서 같은 대기열 규칙(`isReorgDue`)으로 곧바로 처리되게 했다(10분 규칙의 예외를 별도 플래그 없이 표현).
- **되돌리기**: 재구성 뒤 사용자가 직접 다른 곳으로 옮긴 메모는 되돌리기가 건드리지 않는다. 되돌린 이름은 잠그지 않는다(nameLocked 변화 없음).
- **서버 모델 호출**: 구조화 출력은 `tool_choice: {type:'tool'}` 강제 + 이름 있는 도구. 모델 문서상 이 모델은 강제 tool 선택을 받고, thinking·샘플링 파라미터는 보내지 않는다.
- **저장 애니메이션(layoutId 대신)**: 입력 바 미리보기와 대기 카드를 `layoutId`로 잇는 대신, 대기 카드가 입력 바 쪽 아래에서 spring으로 떠올라 자리에 앉는다(`initial={{y:56,scale:.7}}`). 저장 후 Dexie 반영까지의 짧은 공백에서 공유 레이아웃이 깜빡이는 걸 피하려는 선택이고, 보이는 움직임(톡 떠올라 대기 자리로)은 같다.
- **포물선 비행은 spring이 아니라 키프레임(easeOut→easeIn)**: spring은 3점 키프레임을 지원하지 않는다. 비행·재구성 이동만 예외이고, 도착 팝(scale 1.16→1)·무리 출렁임·위치 이동은 spring이다.
- **보드 첫 화면은 전체가 아니라 읽기 좋은 배율(0.72 이상)**: 카드 40개 이상이면 한 화면에 다 담으면 글자가 읽히지 않아서, 가운데 부분을 읽기 좋은 크기로 보여주고 우상단 "전체 보기"로 한눈에 보게 했다.
- **카드 배치는 가로로 늘린 force 공간**: d3 forceCollide는 원형이라, 카드를 가로 1.37배로 펴서 시뮬레이션한 뒤 x를 되돌려 가로로 긴 카드가 겹치지 않게 했다.
- **무리 이름은 멀리서도 읽히게 역배율**: 보드 배율이 낮을 때 무리 이름이 작아지지 않도록 `--ls`(최대 1.9배)로 글자만 키운다.
- **무리 열기는 `layoutId` 대신 같은 보드에서 확대+펼침**: 무리 카드를 중심에서 1.6배로 펼치고 시야를 그 무리로 spring 이동, 다른 무리는 흐리게. 별도 화면을 만들지 않아 닫을 때 정확히 원래 자리로 모인다.
- **카드를 들어 올려도 관련 메모 강조는 유지**하되 곡선은 숨긴다(들고 있는 동안 선이 원래 자리를 가리키지 않게).
- **e2e/개발 훅**: `?demo=1`일 때만 `window.__kk = { db, queue }`를 노출한다(재구성 같은 시나리오를 테스트에서 직접 만들기 위해).
- **재구성 알림 문구의 조사**는 받침에 맞춰 붙인다(`describeReorg`, 단위 테스트 있음).
- **보드 첫 화면 배율**: 처음 열 때만 맞추고(0.72~1.0), 그 뒤 새 메모가 들어와도 시야는 사용자가 정한 대로 둔다.

