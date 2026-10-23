// POST /api/route
// 걸어서·차 경로 두 개를 계산해요: 일반 경로 + 혼잡 구역을 피하는 경로
// GraphHopper 키는 여기(서버)에만 있어서 방문자에게 보이지 않아요.
//
// 요청: { from: {lat,lng}, to: {lat,lng}, profile: 'foot' | 'car', avoid: [{ id, level }] }
//   level: 'mid' | 'high' | 'peak' | 'closed'

import { ZONES } from '../data/zones.js';
import { CLOSURES } from '../data/closures.js';
import { circlePolygon, areasOnPath } from '../lib/geo.js';

const GH_URL = 'https://graphhopper.com/api/1/route';

// 구역 안의 길을 얼마나 꺼릴지 (1 = 그대로, 0에 가까울수록 피함)
// 차는 통제 구간을 거의 못 지나가게, 사람은 붐비는 곳을 더 강하게 피하게 했어요.
const AVOID_STRENGTH = {
  foot: { mid: '0.6', high: '0.2', peak: '0.08', closed: '0.3' },
  car: { mid: '0.8', high: '0.4', peak: '0.2', closed: '0.01' },
};

const AREAS = [...ZONES, ...CLOSURES];

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
    instructions: (path.instructions || []).map((i) => ({
      text: i.text,
      distanceM: Math.round(i.distance),
    })),
    passes: areasOnPath(coords, AREAS),
  };
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
  for (const item of Array.isArray(avoid) ? avoid : []) {
    const area = AREAS.find((a) => a.id === item?.id);
    const strength = AVOID_STRENGTH[profile][item?.level];
    if (!area || !strength) continue;
    const areaId = `z_${area.id}`;
    features.push({
      type: 'Feature',
      id: areaId,
      properties: {},
      geometry: { type: 'Polygon', coordinates: [circlePolygon(area.center, area.radiusM)] },
    });
    priority.push({ if: `in_${areaId}`, multiply_by: strength });
  }

  const plain = await requestGraphHopper(key, base);
  if (!plain.ok) return res.status(502).json({ error: plain.message });

  let smart = null;
  let warning = null;
  if (priority.length) {
    const r = await requestGraphHopper(key, {
      ...base,
      'ch.disable': true,
      custom_model: {
        priority,
        areas: { type: 'FeatureCollection', features },
      },
    });
    if (r.ok) smart = summarize(r.path);
    else warning = `혼잡을 피하는 경로는 계산하지 못해서 일반 경로만 보여드려요. (${r.message})`;
  }

  return res.status(200).json({ plain: summarize(plain.path), smart, warning });
}
