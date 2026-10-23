// 길 안내 계산
// ─────────────────────────────────────────────────────────────
// 안내 계획(plan) = 경로 좌표 + 단계 목록
//   coords : [[경도, 위도], ...]
//   steps  : [{ text, sign, kind, from, to, ... }]  from·to 는 coords 의 번호 (그 단계가 덮는 구간)
// 내 위치가 주어지면 경로에서 가장 가까운 곳을 찾아서
// 지금 단계, 다음 안내까지 거리, 남은 거리, 경로 이탈 여부를 계산해요.
// ─────────────────────────────────────────────────────────────

const M_PER_DEG = 111320;
const xy = ([lng, lat], lat0) => [lng * M_PER_DEG * Math.cos((lat0 * Math.PI) / 180), lat * M_PER_DEG];

export function cumulative(coords) {
  const cum = [0];
  if (!coords.length) return cum;
  const lat0 = coords[0][1];
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = xy(coords[i - 1], lat0);
    const [x2, y2] = xy(coords[i], lat0);
    cum.push(cum[i - 1] + Math.hypot(x2 - x1, y2 - y1));
  }
  return cum;
}

// 경로 위에서 pos([위도, 경도])와 가장 가까운 지점
export function locateOnPath(coords, cum, pos) {
  const lat0 = coords[0][1];
  const [px, py] = xy([pos[1], pos[0]], lat0);
  let best = { seg: 0, along: 0, distM: Infinity };
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = xy(coords[i], lat0);
    const [x2, y2] = xy(coords[i + 1], lat0);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
    const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    if (d < best.distM) best = { seg: i, along: cum[i] + t * Math.sqrt(len2), distM: d };
  }
  if (coords.length === 1) {
    const [x1, y1] = xy(coords[0], lat0);
    best = { seg: 0, along: 0, distM: Math.hypot(px - x1, py - y1) };
  }
  return best;
}

// 경로 이탈로 보는 거리(미터)
export const OFF_ROUTE_M = { walk: 45, car: 70, bus: 120 };
export const ARRIVE_M = 25;

export function navStatus(plan, pos) {
  const { coords, steps, cum } = plan;
  const loc = locateOnPath(coords, cum, pos);
  const total = cum[cum.length - 1];
  let stepIndex = steps.findIndex((s) => loc.seg >= s.from && loc.seg < s.to);
  if (stepIndex < 0) stepIndex = steps.length - 1;
  const step = steps[stepIndex];
  const distToNext = Math.max(0, cum[Math.min(step.to, cum.length - 1)] - loc.along);
  const remaining = Math.max(0, total - loc.along);
  const stepLen = cum[Math.min(step.to, cum.length - 1)] - cum[step.from] || 1;
  return {
    stepIndex,
    distToNext,
    remaining,
    remainingRatio: total ? remaining / total : 0,
    stepProgress: 1 - distToNext / stepLen, // 이 단계에서 얼마나 왔는지 (0~1)
    offBy: loc.distM,
    offRoute: loc.distM > (OFF_ROUTE_M[plan.mode] || 50),
    arrived: remaining < ARRIVE_M && loc.distM < 60,
  };
}

// ── 안내 계획 만들기 ─────────────────────────────────────

// 걸어서·차: GraphHopper 경로 (instructions 에 interval 이 들어 있음)
export function planFromPath(route, mode) {
  const coords = route.coords;
  const steps = route.instructions
    .filter((i) => Array.isArray(i.interval))
    .map((i) => ({ text: i.text, sign: i.sign ?? 0, kind: mode, from: i.interval[0], to: Math.max(i.interval[1], i.interval[0]) }));
  // 각 단계의 "다음 안내"는 그 단계가 끝나는 곳에서 해야 할 행동(다음 단계 문구)
  steps.forEach((s, k) => { s.next = steps[k + 1] || null; });
  return finish({ mode, coords, steps, minutes: route.minutes, distanceM: route.distanceM });
}

// 버스: 카카오 대중교통 경로 + 출발·도착 걷는 구간
export function planFromTransit(route, from, to, busNames) {
  const coords = [];
  const steps = [];
  const push = (pts, step) => {
    if (!pts.length) return;
    const start = coords.length ? coords.length - 1 : 0;
    // 이어지는 점이 같으면 하나 생략
    const add = coords.length && pts[0][0] === coords[coords.length - 1][0] && pts[0][1] === coords[coords.length - 1][1] ? pts.slice(1) : pts;
    coords.push(...add);
    steps.push({ ...step, from: start, to: coords.length - 1 });
  };
  const rides = route.steps.filter((s) => s.type !== 'WALKING');
  const first = route.steps.find((s) => s.coords.length)?.coords[0];
  const lastStep = [...route.steps].reverse().find((s) => s.coords.length);
  const last = lastStep?.coords[lastStep.coords.length - 1];

  if (first) push([[from.lng, from.lat], first], { kind: 'walk', sign: 0, text: `${rides[0]?.from || '첫 정류장'}까지 걸어가세요` });
  for (const s of route.steps) {
    if (!s.coords.length) continue;
    if (s.type === 'WALKING') {
      push(s.coords, { kind: 'walk', sign: 0, text: '환승하러 걸어가세요' });
    } else {
      push(s.coords, {
        kind: 'ride',
        sign: 0,
        bus: busNames(s),
        board: s.from,
        alight: s.to,
        stopCount: s.stopCount,
        text: `${busNames(s)}번 버스를 타고 ${s.to || '내릴 곳'}에서 내리세요`,
      });
    }
  }
  if (last) push([last, [to.lng, to.lat]], { kind: 'walk', sign: 4, text: '내려서 도착지까지 걸어가세요' });
  steps.forEach((s, k) => { s.next = steps[k + 1] || null; });
  return finish({ mode: 'bus', coords, steps, minutes: route.total, distanceM: route.distanceM });
}

function finish(plan) {
  plan.cum = cumulative(plan.coords);
  return plan;
}

// 방향 표시 (GraphHopper sign 값)
export function signArrow(sign) {
  return ({
    '-98': '↶', '-8': '↶', '-7': '↖', '-3': '↰', '-2': '←', '-1': '↖',
    0: '↑', 1: '↗', 2: '→', 3: '↱', 4: '◎', 5: '•', 6: '⟳', 7: '↗', 8: '↷',
  })[String(sign)] || '↑';
}
