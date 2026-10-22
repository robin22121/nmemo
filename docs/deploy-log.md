# 운영 배포 로그

한 배포 = 한 줄. 롤백할 때 이 표만 보면 되게 쓴다. STATUS.md에는 배포 이력을 쓰지 않는다. 롤백: Vercel 대시보드 → Deployments에서 이전 Production을 Promote, 또는 `git revert` 후 push. 서버 DB 없음(데이터는 사용자 기기 IndexedDB) → 백업 열은 해당 없음.

| 날짜 | 커밋 | 백업 | DB 리비전 | 내용 | 프런트 |
|---|---|---|---|---|---|
| 2026-10-22 | bd3ed82 | 해당 없음 | Dexie v2 | 첫 Vercel 배포(정적 앱만, LocalAnalyzer) | nmemo-five.vercel.app |
| 2026-10-22 | 573d88e | 해당 없음 | Dexie v2 | `/api/*` Vercel Function 연결, AI 정돈 켬 | 같음 |
| 2026-10-22 | 74429f4 | 해당 없음 | Dexie v2 | 사이트 전체 Basic Auth | 같음 |
| 2026-10-22 | 49beb4f | 해당 없음 | Dexie v2 | 휴대폰 화면 치우침 수정(PR #1 위에 rAF 수정) | 같음 |
| 2026-10-22 | 8235fc9 | 해당 없음 | Dexie v2 | 새로 쓰기 삭제·주제 빛 스타일·길게 눌러 옮기기·AI 주제 색·배경 주제 또렷·연결 배지·이동 기록 | 같음 |
| 2026-10-22 | a93bd83 | 해당 없음 | Dexie v2 | 정면 이름표 누르면 접힘(D29) | 같음 |
| 2026-10-22 | 42a3e70 | 해당 없음 | Dexie v2(선택 필드 추가) | 카드가 커지는 메모장(수정·설정·자판) | 같음 |
| 2026-10-22 | 5cb6353 | 해당 없음 | Dexie v2(선택 필드 lockedAt·organizedAt) | 0단계: 평면 보드·Firebase 삭제, ⋯ 메뉴(내보내기·가져오기·오분류율), 문서 체계 | 같음 |
| 2026-10-22 | a6edae4 | 해당 없음 | Dexie v2 | 빈 하늘 탭 쓰기(D30, 이후 취소), 홈 화면 앱 크기 0 측정 대응(U1), 메뉴 진단 줄 | 같음 |
| 2026-10-23 | ff0c227 | 해당 없음 | Dexie v2 | 배경 주제 계속 자전(D31), 아래 가운데 +·길게 누르면 백업 패널·⋯ 메뉴 삭제(D32), 주제 옆 + 삭제·주제 칩(D33) | 같음 |

## 운영 환경 메모 (배포가 아닌 상태)

- 2026-10-22 Vercel 환경변수 `ANTHROPIC_API_KEY`(Production·Preview, 채팅 노출 키 — 교체 대기), `APP_LOGIN_ID`·`APP_LOGIN_PASSWORD`(Production·Preview).
- GitHub `main` push = 운영 자동 배포(Vercel Git 연결).
- 2026-10-22 Vercel 방화벽 규칙 `api-rate-limit` 게시: `/api` 경로 IP당 3600초 150회(fixed_window), 초과 시 429. 끄기: `vercel firewall rules` → 비활성화 후 `vercel firewall publish`.
