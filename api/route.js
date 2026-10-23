// POST /api/route
// 걸어서·차 경로 두 개를 계산해요: 일반 경로 + 혼잡 구역을 피하는 경로
// GraphHopper 키는 여기(서버)에만 있어서 방문자에게 보이지 않아요.
//
// 요청: { from: {lat,lng}, to: {lat,lng}, profile: 'foot' | 'car', avoid: [{ id, level }] }
//   level: 'mid' | 'high' | 'peak' | 'closed'

import { ZONES } from '../data/zones.js';
import { CLOSURES } from '../data/closures.js';
import { areaRing, areasOnPath, areaContains, areaCenter, distanceM } from '../lib/geo.js';

const GH_URL = 'https://graphhopper.com/api/1/route';

// 구역 안의 길을 얼마나 꺼릴지 (1 = 그대로, 0에 가까울수록 피함)
// 차는 통제 구간을 거의 못 지나가게, 사람은 붐비는 곳을 더 강하게 피하게 했어요.
const AVOID_STRENGTH = {
  foot: { mid: '0.6', high: '0.2', peak: '0.08', closed: '0.3' },
  car: { mid: '0.8', high: '0.4', peak: '0.2', closed: '0.01' },
};

const AREAS = [...ZONES, ...CLOSURES];

// 경유지 방식에서 경로 점수 매길 때, 구역을 지나가면 더하는 "벌점(분)"
// 이 숫자가 클수록 시간이 더 걸려도 돌아가는 길을 골라요.
const PASS_PENALTY_MIN = {
  foot: { mid: 4, high: 12, peak: 25, closed: 8 },
  car: { mid: 2, high: 6, peak: 12, closed: 60 },
};
const MAX_DETOUR_TRIES = 4; // 경유지 후보 몇 개까지 계산해 볼지 (하나당 GraphHopper 1회)

// GraphHopper 구역 피하기(custom model)가 이 플랜에서 막혀 있으면 기억해 두고 다음부턴 바로 경유지 방식으로
let customModelBlocked = false;

function validPoint(p) {
  return (
    p && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    p.lat > 33 && p.lat < 39 && p.lng > 124 && p.lng < 132
  );
}

async function requestGraphHopper(key, body) {
  try {
    const r = await fetch(`${GH_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.paths?.length) {
      return { ok: false, message: data.message || `GraphHopper 응답 오류 (${r.status})` };
    }
    return { ok: true, path: data.paths[0] };
  } catch (e) {
    return { ok: false, message: `GraphHopper에 연결하지 못했어요: ${e.message}` };
  }
}

function summarize(path) {
  const coords = path.points?.coordinates || [];
  return {
    distanceM: Math.round(path.distance),
    minutes: Math.max(1, Math.round(path.time / 60000)),
    ascendM: Math.round(path.ascend || 0),
    coords, // [경도, 위도]
    instructions: (path.instructions || [])
      .filter((i) => i.sign !== 5) // '경유지 도착' 안내는 빼기
      .map((i) => ({ text: i.text, distanceM: Math.round(i.distance) })),
    passes: areasOnPath(coords, AREAS),
  };
}

// ── 경유지 방식 ─────────────────────────────────────────
// 1) 가장 짧은 길이 지나가는 혼잡 구역을 찾고
// 2) 그 구역의 왼쪽·오른쪽 바깥에 경유지 후보를 잡아서
// 3) 출발 → 경유지 → 도착 경로를 계산한 뒤
// 4) (걸리는 시간 + 지나가는 구역 벌점)이 가장 작은 길을 골라요.

function areaRadiusM(area) {
  if (area.polygon?.length >= 3) {
    const c = areaCenter(area);
    return Math.max(...area.polygon.map((p) => distanceM(c, p)));
  }
  return area.radiusM;
}

// 장애물(구역) 옆으로 돌아가는 경유지 후보 만들기
// 가는 방향 기준 왼쪽·오른쪽 각각: 옆으로 한 번 꺾는 길(경유지 1개) + 둥글게 감싸는 길(경유지 2개)
const M_PER_DEG_LAT = 111320;
function sideDetours(center, radiusM, avoidAreas, from, to) {
  const [clat, clng] = center;
  const mLng = M_PER_DEG_LAT * Math.cos((clat * Math.PI) / 180);
  // 출발→도착 방향 (동쪽 x, 북쪽 y, 단위 벡터)
  let dx = (to.lng - from.lng) * mLng;
  let dy = (to.lat - from.lat) * M_PER_DEG_LAT;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const toLatLng = (x, y) => [clat + y / M_PER_DEG_LAT, clng + x / mLng];
  const outside = (pt) => !avoidAreas.some((a) => areaContains(a, pt));

  const result = [];
  for (const side of [1, -1]) {
    const nx = -dy * side;
    const ny = dx * side;
    for (const scale of [1.3, 1.7]) {
      const r = radiusM * scale + 60;
      const single = toLatLng(nx * r, ny * r);
      const ang = (35 * Math.PI) / 180;
      const back = toLatLng((nx * Math.cos(ang) - dx * Math.sin(ang)) * r, (ny * Math.cos(ang) - dy * Math.sin(ang)) * r);
      const front = toLatLng((nx * Math.cos(ang) + dx * Math.sin(ang)) * r, (ny * Math.cos(ang) + dy * Math.sin(ang)) * r);
      if (outside(single) && outside(back) && outside(front)) {
        result.push({ side, vias: [single] }, { side, vias: [back, front] });
        break; // 이쪽 방향은 이 거리로 충분
      }
    }
  }
  return result;
}

// 여러 구역을 한 덩어리로 봤을 때의 가운데와 반경 (붙어 있는 구역을 한 번에 돌아가기 위해)
function clusterOf(areas) {
  const centers = areas.map(areaCenter);
  const c = [centers.reduce((s, p) => s + p[0], 0) / centers.length, centers.reduce((s, p) => s + p[1], 0) / centers.length];
  const r = Math.max(...areas.map((a) => distanceM(c, areaCenter(a)) + areaRadiusM(a)));
  return { center: c, radiusM: r };
}

function scorePath(summary, avoidLevels, profile) {
  const penalty = summary.passes.reduce((sum, id) => sum + (PASS_PENALTY_MIN[profile][avoidLevels[id]] || 0), 0);
  return summary.minutes + penalty;
}

async function detourRoute(key, base, plainSummary, avoidItems, profile, from, to) {
  const avoidLevels = Object.fromEntries(avoidItems.map((x) => [x.area.id, x.level]));
  const avoidAreas = avoidItems.map((x) => x.area);
  // 출발지·도착지가 안에 있는 구역은 어차피 못 피하니 빼고, 붐비는 순서로
  const order = ['closed', 'peak', 'high', 'mid'];
  const targets = avoidItems
    .filter((x) => plainSummary.passes.includes(x.area.id))
    .filter((x) => !areaContains(x.area, [from.lat, from.lng]) && !areaContains(x.area, [to.lat, to.lng]))
    .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  if (!targets.length) return { smart: null, note: null };

  // 피할 구역이 여러 개면 한 덩어리로 보고, 그 양옆으로 돌아가는 후보를 만들어요
  const obstacle = targets.length > 1
    ? clusterOf(targets.map((x) => x.area))
    : { center: areaCenter(targets[0].area), radiusM: areaRadiusM(targets[0].area) };
  const picks = sideDetours(obstacle.center, obstacle.radiusM, avoidAreas, from, to);
  const tries = await Promise.all(
    picks.slice(0, MAX_DETOUR_TRIES).map((p) =>
      requestGraphHopper(key, {
        ...base,
        points: [[from.lng, from.lat], ...p.vias.map(([lat, lng]) => [lng, lat]), [to.lng, to.lat]],
      }),
    ),
  );

  let best = { summary: plainSummary, score: scorePath(plainSummary, avoidLevels, profile) };
  for (const t of tries) {
    if (!t.ok) continue;
    const summary = summarize(t.path);
    const score = scorePath(summary, avoidLevels, profile);
    if (score < best.score) best = { summary, score };
  }
  if (best.summary === plainSummary) {
    return { smart: null, note: '혼잡 구역을 돌아가는 길이 너무 멀어서 가장 짧은 길로 안내해요.' };
  }
  return { smart: best.summary, note: null };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 받아요.' });
  }
  const key = process.env.GRAPHHOPPER_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: 'GRAPHHOPPER_API_KEY가 설정되지 않았어요. Vercel 프로젝트 설정 → Environment Variables에 추가해 주세요.',
    });
  }

  const { from, to, avoid = [] } = req.body || {};
  const profile = req.body?.profile === 'car' ? 'car' : 'foot';
  if (!validPoint(from) || !validPoint(to)) {
    return res.status(400).json({ error: '출발지와 도착지 좌표가 올바르지 않아요.' });
  }

  const base = {
    profile,
    points: [[from.lng, from.lat], [to.lng, to.lat]],
    points_encoded: false,
    instructions: true,
    locale: 'ko',
  };

  // 회피 구역 만들기 (서버에 등록된 구역 id만 사용)
  const features = [];
  const priority = [];
  const avoidItems = [];
  for (const item of Array.isArray(avoid) ? avoid : []) {
    const area = AREAS.find((a) => a.id === item?.id);
    const strength = AVOID_STRENGTH[profile][item?.level];
    if (!area || !strength) continue;
    avoidItems.push({ area, level: item.level });
    const areaId = `z_${area.id}`;
    features.push({
      type: 'Feature',
      id: areaId,
      properties: {},
      geometry: { type: 'Polygon', coordinates: [areaRing(area)] },
    });
    priority.push({ if: `in_${areaId}`, multiply_by: strength });
  }

  const plain = await requestGraphHopper(key, base);
  if (!plain.ok) return res.status(502).json({ error: plain.message });

  const plainSummary = summarize(plain.path);
  let smart = null;
  let note = null;
  let method = 'none';
  let customError = null;

  if (priority.length) {
    // 1순위: GraphHopper 구역 피하기 (플랜에서 허용될 때)
    if (!customModelBlocked) {
      const r = await requestGraphHopper(key, {
        ...base,
        'ch.disable': true,
        custom_model: { priority, areas: { type: 'FeatureCollection', features } },
      });
      if (r.ok) {
        smart = summarize(r.path);
        method = 'custom_model';
      } else {
        customError = r.message;
        customModelBlocked = true;
      }
    }
    // 2순위: 경유지 방식
    if (method !== 'custom_model') {
      const d = await detourRoute(key, base, plainSummary, avoidItems, profile, from, to);
      smart = d.smart;
      note = d.note;
      method = 'detour';
    }
  }

  return res.status(200).json({ plain: plainSummary, smart, note, warning: null, method, customError });
}
