// POST /api/transit
// 카카오 대중교통 경로 조회로 버스 경로 후보를 받아요.
// 카카오 REST API 키는 여기(서버)에만 있어서 방문자에게 보이지 않아요.
//
// 요청: { from: {lat,lng,name}, to: {lat,lng,name} }
// 참고: 카카오 응답에는 출발지→첫 정류장, 마지막 정류장→도착지 걷는 길이 빠져 있어서
//       그 거리를 따로 계산해 돌려줘요 (walkStartM, walkEndM).
// 카카오 정책상 응답을 서버에 저장해 두지 않아요.

import { ZONES } from '../data/zones.js';
import { CLOSURES } from '../data/closures.js';
import { areasOnPath, distanceM } from '../lib/geo.js';

const KAKAO_URL = 'https://dapi.kakao.com/v2/routing/publictraffic';
const AREAS = [...ZONES, ...CLOSURES];
const MAX_ROUTES = 6;

const STATUS_MESSAGE = {
  STARTNODES_NULL: '출발지 근처에 정류장이 없어요.',
  ENDNODES_NULL: '도착지 근처에 정류장이 없어요.',
  EQUAL_POINTS: '출발지와 도착지가 같아요.',
  NO_RESULTS: '대중교통 경로가 없어요. 걸어서 가는 게 나을 수 있어요.',
  INVALID_REQUEST: '요청이 올바르지 않아요.',
};

function validPoint(p) {
  return (
    p && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    p.lat > 33 && p.lat < 39 && p.lng > 124 && p.lng < 132
  );
}

const cleanName = (s) => String(s || '').slice(0, 40);

function simplifyRoute(route, from, to) {
  const props = route.properties || {};
  const steps = (route.steps || []).map((s) => {
    const p = s.properties || {};
    const stops = (p.stops || []).map((x) => x?.name).filter(Boolean);
    return {
      type: p.type || 'WALKING',
      guidance: p.guidance || '',
      distanceM: Math.round(p.distance || 0),
      minutes: Math.max(0, Math.round((p.time || 0) / 60)),
      from: stops[0] || null,
      to: stops.length > 1 ? stops[stops.length - 1] : null,
      stopCount: Math.max(0, stops.length - 1),
      vehicles: (p.vehicles || []).map((v) => ({ name: String(v?.name ?? ''), type: String(v?.type ?? '') })),
      coords: (s.path?.points || []).filter((pt) => Array.isArray(pt) && pt.length >= 2), // [경도, 위도]
    };
  });

  const ride = steps.filter((s) => s.type !== 'WALKING');
  const rideCoords = ride.flatMap((s) => s.coords);
  const allCoords = steps.flatMap((s) => s.coords);
  const first = allCoords[0];
  const last = allCoords[allCoords.length - 1];

  return {
    type: props.type || 'BUS',
    distanceM: Math.round(props.totalDistance || 0),
    minutes: Math.round((props.totalTime || 0) / 60),
    stepMinutes: steps.reduce((a, s) => a + s.minutes, 0),
    transfers: props.transfers ?? Math.max(0, ride.length - 1),
    fare: props.fare?.value ?? null,
    steps,
    walkStartM: first ? Math.round(distanceM([from.lat, from.lng], [first[1], first[0]])) : 0,
    walkEndM: last ? Math.round(distanceM([last[1], last[0]], [to.lat, to.lng])) : 0,
    passes: areasOnPath(rideCoords, AREAS), // 버스가 지나가는 혼잡 구역·통제 구역
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 받아요.' });

  const key = process.env.KAKAO_REST_KEY;
  if (!key) {
    return res.status(500).json({
      error: 'KAKAO_REST_KEY가 설정되지 않았어요. Vercel 프로젝트 설정 → Environment Variables에 카카오 REST API 키를 추가해 주세요.',
    });
  }

  const { from, to } = req.body || {};
  if (!validPoint(from) || !validPoint(to)) {
    return res.status(400).json({ error: '출발지와 도착지 좌표가 올바르지 않아요.' });
  }

  const params = new URLSearchParams({
    start_x: String(from.lng),
    start_y: String(from.lat),
    end_x: String(to.lng),
    end_y: String(to.lat),
    s_name: cleanName(from.name) || '출발',
    e_name: cleanName(to.name) || '도착',
  });

  let data;
  try {
    const r = await fetch(`${KAKAO_URL}?${params}`, { headers: { Authorization: `KakaoAK ${key}` } });
    data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data.msg || data.message || `카카오 응답 오류 (${r.status})`;
      const hint = r.status === 401 || r.status === 403
        ? ' REST API 키가 맞는지, 카카오맵 사용 설정이 켜져 있는지 확인해 주세요.'
        : r.status === 429 ? ' 오늘 무료 호출 한도를 다 썼어요.' : '';
      return res.status(502).json({ error: msg + hint });
    }
  } catch (e) {
    return res.status(502).json({ error: `카카오에 연결하지 못했어요: ${e.message}` });
  }

  if (data.status !== 'OK') {
    return res.status(200).json({
      routes: [],
      message: STATUS_MESSAGE[data.status] || `경로를 찾지 못했어요 (${data.status || '알 수 없음'}).`,
    });
  }

  const routes = (data.routes || []).slice(0, MAX_ROUTES).map((r) => simplifyRoute(r, from, to));
  return res.status(200).json({
    routes,
    landingURL: data.properties?.landingURL || null,
  });
}
