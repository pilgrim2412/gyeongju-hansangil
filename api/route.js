// POST /api/route
// 걸어서·차 경로 두 개를 계산해요: 일반 경로 + 혼잡 구역을 피하는 경로
// GraphHopper 키는 여기(서버)에만 있어서 방문자에게 보이지 않아요.
//
// 요청: { from: {lat,lng}, to: {lat,lng}, profile: 'foot' | 'car', avoid: [{ id, level }] }
//   level: 'mid' | 'high' | 'peak' | 'closed'

import { ZONES } from '../data/zones.js';
import { CLOSURES } from '../data/closures.js';
import { areaRing, areasOnPath, areaContains, distanceM } from '../lib/geo.js';

const GH_URL = 'https://graphhopper.com/api/1/route';

// 구역 안의 길을 얼마나 꺼릴지 (1 = 그대로, 0에 가까울수록 피함)
// 차는 통제 구간을 거의 못 지나가게, 사람은 붐비는 곳을 더 강하게 피하게 했어요.
const AVOID_STRENGTH = {
  foot: { mid: '0.6', high: '0.2', peak: '0.08', closed: '0.3' },
  car: { mid: '0.8', high: '0.4', peak: '0.2', closed: '0.01' },
};

const AREAS = [...ZONES, ...CLOSURES];

// 경유지 방식에서 경로 점수 매기기
// 혼잡 구역 안을 지나는 동안은 "실제보다 몇 배 오래 걸리는 것처럼" 쳐요.
// 예) 걸어서 매우 혼잡 4배: 구역 안을 2분 걸으면 6분 손해로 계산 → 모서리를 살짝 스치는 건 작은 손해
const CROWD_COST = {
  foot: { mid: 1.5, high: 2.5, peak: 4, closed: 2 },
  car: { mid: 1.3, high: 1.8, peak: 2.5, closed: 30 },
};
// 돌아가는 길이 가장 짧은 길보다 이만큼 넘게 오래 걸리면 후보에서 빼요
const MAX_EXTRA_RATIO = 1.5;
const MAX_EXTRA_MIN = { foot: 12, car: 10 };
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
      .map((i) => ({ text: i.text, distanceM: Math.round(i.distance), sign: i.sign, interval: i.interval })),
    passes: areasOnPath(coords, AREAS),
  };
}

// ── 경유지 방식 ─────────────────────────────────────────
// 1) 가장 짧은 길이 혼잡 구역에 들어가는 구간(들어가는 점·나오는 점)을 찾고
// 2) 그 구간 바로 옆, 구역 바깥으로 비켜선 곳에 경유지를 잡아서
// 3) 출발 → 경유지 → 도착 경로를 몇 개 더 계산한 뒤
// 4) 너무 멀리 돌아가는 건 빼고, 혼잡 비용이 가장 작은 길을 골라요.

const M_PER_DEG_LAT = 111320;

// 경로가 각 구역 안을 지나는 거리(미터)
function insideMeters(coords, area) {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    if (areaContains(area, [(lat1 + lat2) / 2, (lng1 + lng2) / 2])) m += distanceM([lat1, lng1], [lat2, lng2]);
  }
  return m;
}

function routeCost(summary, avoidItems, profile) {
  const speed = summary.distanceM / Math.max(1, summary.minutes); // 이 경로의 분당 이동 거리
  let cost = summary.minutes;
  for (const { area, level } of avoidItems) {
    const m = insideMeters(summary.coords, area);
    if (m > 0) cost += (m / speed) * ((CROWD_COST[profile][level] || 1) - 1);
  }
  return cost;
}

// p 지점에서 방향 (nx, ny)로 조금씩 나가면서 피할 구역을 벗어나는 첫 지점 + 여유 40m
function stepOutside(p, nx, ny, avoidAreas) {
  const mLng = M_PER_DEG_LAT * Math.cos((p[0] * Math.PI) / 180);
  for (let d = 30; d <= 1500; d += 30) {
    const q = [p[0] + (ny * d) / M_PER_DEG_LAT, p[1] + (nx * d) / mLng];
    if (!avoidAreas.some((a) => areaContains(a, q))) {
      const e = d + 40;
      return [p[0] + (ny * e) / M_PER_DEG_LAT, p[1] + (nx * e) / mLng];
    }
  }
  return null;
}

function nearDetours(coords, targets, avoidAreas) {
  // 피할 구역 안에 있는 경로 점들 중 가장 긴 연속 구간
  const inside = coords.map(([lng, lat]) => targets.some((a) => areaContains(a, [lat, lng])));
  let best = null;
  for (let i = 0; i < inside.length; i++) {
    if (!inside[i]) continue;
    let j = i;
    while (j + 1 < inside.length && inside[j + 1]) j++;
    if (!best || j - i > best[1] - best[0]) best = [i, j];
    i = j;
  }
  if (!best) return [];
  const [i0, i1] = best;
  const entry = [coords[i0][1], coords[i0][0]];
  const exit = [coords[i1][1], coords[i1][0]];
  const mid = [coords[Math.floor((i0 + i1) / 2)][1], coords[Math.floor((i0 + i1) / 2)][0]];

  // 들어가는 점 → 나오는 점 방향 (너무 짧으면 그 앞뒤 경로 방향)
  const a = coords[Math.max(0, i0 - 3)];
  const b = coords[Math.min(coords.length - 1, i1 + 3)];
  const mLng = M_PER_DEG_LAT * Math.cos((mid[0] * Math.PI) / 180);
  let dx = (b[0] - a[0]) * mLng;
  let dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;

  const out = [];
  for (const side of [1, -1]) {
    const nx = -dy * side;
    const ny = dx * side;
    const m = stepOutside(mid, nx, ny, avoidAreas);
    if (m) out.push({ vias: [m] });
    const e = stepOutside(entry, nx, ny, avoidAreas);
    const x = stepOutside(exit, nx, ny, avoidAreas);
    if (e && x) out.push({ vias: [e, x] });
  }
  return out;
}

async function detourRoute(key, base, plainSummary, avoidItems, profile, from, to) {
  const targets = avoidItems
    .filter((x) => plainSummary.passes.includes(x.area.id))
    .filter((x) => !areaContains(x.area, [from.lat, from.lng]) && !areaContains(x.area, [to.lat, to.lng]))
    .map((x) => x.area);
  if (!targets.length) return { smart: null, note: null };

  const avoidAreas = avoidItems
    .map((x) => x.area)
    .filter((a) => !areaContains(a, [from.lat, from.lng]) && !areaContains(a, [to.lat, to.lng]));
  const picks = nearDetours(plainSummary.coords, targets, avoidAreas).slice(0, MAX_DETOUR_TRIES);
  const tries = await Promise.all(
    picks.map((p) =>
      requestGraphHopper(key, {
        ...base,
        points: [[from.lng, from.lat], ...p.vias.map(([lat, lng]) => [lng, lat]), [to.lng, to.lat]],
      }),
    ),
  );

  const limit = Math.min(plainSummary.minutes * MAX_EXTRA_RATIO, plainSummary.minutes + MAX_EXTRA_MIN[profile]);
  let best = { summary: plainSummary, cost: routeCost(plainSummary, avoidItems, profile) };
  let tooFar = false;
  for (const t of tries) {
    if (!t.ok) continue;
    const summary = summarize(t.path);
    if (summary.minutes > Math.max(limit, plainSummary.minutes + 2)) { tooFar = true; continue; }
    const cost = routeCost(summary, avoidItems, profile);
    if (cost < best.cost - 0.5) best = { summary, cost };
  }
  if (best.summary === plainSummary) {
    return {
      smart: null,
      note: tooFar
        ? '혼잡 구역을 피하려면 너무 많이 돌아가야 해서 가장 짧은 길로 안내해요.'
        : '가장 짧은 길이 혼잡 구역을 조금만 지나서 그대로 안내해요.',
    };
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
