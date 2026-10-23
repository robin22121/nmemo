/** 지구본 보드의 시험용 스위치와 움직임 상수. 배치·투영 상수는 core/layout/globe.ts의 GLOBE. */

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

/** 앱을 켜면 쓰기 모드(흐린 지구본 앞 큰 쓰기 칸). 시험용으로 `&write=0`이면 바로 보드 */
export const WRITE_START = params.get('write') !== '0';

export const MOTION = {
  /** 좌우 끌기 1px당 회전(°) — 화면 폭 390px에 약 60°(D35) */
  degPerPx: 0.16,
  wheelDegPerPx: 0.12,
  /** 속도 없이 맞추는 스냅(느린 손 떼기·휠·주제로 돌리기)의 임계 감쇠 각진동수(1/s). 클수록 빨리 멈춘다 */
  snapOmega: 9,
  /** 관성: 손 뗄 때 속도 × 이 시간만큼 더 간 곳에 가장 가까운 주제를 고른다(s) */
  inertiaLead: 0.15,
  maxVel: 900,
  /** 밀고 난 감속(D34): 손 뗄 때 속도를 이어받아 남은 거리에 비례해 느려진다. 감속률(1/s) 범위. 작을수록 끝이 길고 부드럽다 */
  glideOmegaMin: 7,
  glideOmegaMax: 12,
  /** 이보다 느리게 손을 떼면(°/s) 감속 대신 snapOmega 스냅으로 가장 가까운 주제에 */
  glideMinVel: 30,
  /** 느린 손 떼기라도 이 속도(°/s) 이상이면 밀던 방향 앞쪽 주제로 스냅(되돌아가지 않게, D35 ③) */
  snapDirVel: 5,
  /** 손 뗄 때 속도는 마지막 이 시간(ms) 동안의 손가락 움직임으로 잰다 */
  velWindowMs: 100,
  /** 마지막 움직임 뒤 이만큼(ms) 가만히 있다 떼면 멈춘 손가락으로 본다(속도를 깎는다) */
  restMs: 40,
  /** 이만큼 움직이기 전까지는 탭으로 본다(px) */
  tapSlop: 8,
  /** 카드를 이만큼 가만히 누르면 들어 올려 다른 주제로 옮길 수 있다(ms) */
  liftMs: 450,
  /** 화면 왼쪽 가장자리는 뒤로가기 스와이프용으로 비운다(px) */
  edgeFree: 20,
  /** 쓰기 모드 배경 자동 회전(°/s) */
  autorotate: 5,
  /** 보드(하늘 상태 전체, 집중 상태의 배경 주제) 자전(°/s). 쓰기 모드보다 느리고 차분하게(D31, D35 3 → 2) */
  boardAutorotate: 2,
  /** 만지거나 패널을 닫은 뒤 이만큼 가만히 있으면 자전이 다시 시작한다(ms) */
  autorotateResumeMs: 4000,
  /** 펼친 카드가 닿는 화면 위 여백(px). 아래는 입력 바 위 */
  topPad: 10,
  /** 아래 여백(px): + 버튼 8 + 52 + 틈 10. 여기에 기기의 safe-area-inset-bottom을 더한다 */
  bottomPad: 70,
  /** 백그라운드에 이만큼 있다 돌아오면 다시 쓰기 모드(ms) */
  writeAgainAfter: 5 * 60 * 1000,
  /** 연달아 저장할 때 회전을 합치는 시간(ms): 이 안에 정돈된 메모는 마지막 주제로 한 번만 돈다 */
  mergeRotateMs: 350,
} as const;
