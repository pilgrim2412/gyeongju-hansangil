// 국가교통정보센터(ITS) 오픈API 응답 정리
// ─────────────────────────────────────────────────────────────
// 서버(api/events.js, api/speeds.js)와 화면(app.js)이 같이 써요.
// ITS는 같은 값을 이름을 조금씩 바꿔서 주기도 해서, 여러 이름을 다 확인해요.
// ─────────────────────────────────────────────────────────────

// 경주 관광지 일대 (경도 X, 위도 Y)
export const GYEONGJU_BBOX = { minX: 129.15, maxX: 129.40, minY: 35.75, maxY: 35.90 };

const pick = (row, ...names) => {
  for (const n of names) {
    const v = row?.[n];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ITS 응답에서 항목 목록 꺼내기 (JSON 모양이 서비스마다 조금 달라요)
export function itsItems(payload) {
  const body = payload?.body ?? payload?.response?.body ?? payload;
  let items = body?.items ?? body?.item ?? payload?.items;
  if (items && !Array.isArray(items) && Array.isArray(items.item)) items = items.item;
  if (Array.isArray(items)) return items.filter((x) => x && typeof x === 'object');
  if (items && typeof items === 'object') return [items];
  return [];
}

// ITS 오류 응답이면 이유를, 아니면 null
export function itsError(payload) {
  const h = payload?.header ?? payload?.response?.header;
  const code = h?.resultCode;
  if (code === undefined || code === null || code === '' || code === 0 || code === '0' || code === '00') return null;
  return `${code} ${h.resultMsg || ''}`.trim();
}

// '20261026093000', '2026-10-26 09:30:00' → '2026-10-26T09:30' (한국 시간 그대로)
export function itsTime(v) {
  if (v === null || v === undefined) return null;
  const d = String(v).replace(/\D/g, '');
  if (d.length < 12) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}`;
}

// ── 돌발상황 ─────────────────────────────────────────
const KIND = [
  [/사고|acc/i, '사고'],
  [/공사|cor|con/i, '공사'],
  [/행사|ete|event|마라톤|축제|대회/i, '행사'],
  [/기상|wea/i, '기상'],
  [/재난|dis/i, '재난'],
  [/통제|규제|reg/i, '통제'],
];
// 유형 → 세부 유형 → 문구 순서로 먼저 맞는 것 (문구에 "사고 주의"가 있어도 유형이 공사면 공사)
function kindOf(...texts) {
  for (const t of texts.filter(Boolean)) {
    for (const [re, k] of KIND) if (re.test(t)) return k;
  }
  return '기타';
}

// 차가 아예 못 지나가는 통제인지 (문구로 판단)
const FULL_BLOCK = /전면|전차로|차단|폐쇄|통행금지|양방향\s*통제|진입\s*금지/;

export function normalizeEvent(row, i = 0) {
  let lng = num(pick(row, 'coordX', 'coordx', 'xCoord', 'lon', 'lng'));
  let lat = num(pick(row, 'coordY', 'coordy', 'yCoord', 'lat'));
  if (lat !== null && lng !== null && lat > 100 && lng < 100) [lat, lng] = [lng, lat]; // 뒤바뀐 경우
  if (lat === null || lng === null || lat < 33 || lat > 39 || lng < 124 || lng > 132) return null;
  const type = String(pick(row, 'eventType', 'event_type', 'type') || '');
  const detail = String(pick(row, 'eventDetailType', 'event_detail_type', 'eventDetail') || '');
  const message = String(pick(row, 'message', 'msg', 'eventCn', 'eventContent') || '').trim();
  const road = String(pick(row, 'roadName', 'road_name', 'roadNm') || '').trim();
  const lanes = String(pick(row, 'lanesBlockType', 'lanesBlocked', 'lanes_block_type') || '');
  const kind = kindOf(type, detail, message);
  const text = `${detail} ${message} ${lanes}`;
  return {
    id: `its_${String(pick(row, 'eventId', 'id', 'linkId') || '').replace(/\W/g, '') || i}_${i}`,
    kind,
    detail,
    message,
    road,
    lat,
    lng,
    start: itsTime(pick(row, 'startDate', 'start_date', 'startDt')),
    end: itsTime(pick(row, 'endDate', 'end_date', 'endDt')),
    blocked: FULL_BLOCK.test(text) || lanes === '2' || /전면/.test(lanes),
  };
}

export function inBox(lat, lng, box = GYEONGJU_BBOX) {
  return lng >= box.minX && lng <= box.maxX && lat >= box.minY && lat <= box.maxY;
}

// 돌발상황 하나를 길찾기에서 피할 "통제 구역"으로 바꾸기
//   nowYmdHm: 정보를 받은 시각 'YYYY-MM-DDTHH:MM' (끝나는 시각이 없으면 그날 자정까지로 봄)
export function eventToClosure(ev, nowYmdHm) {
  const title = `${ev.kind}${ev.road ? `: ${ev.road}` : ''}`;
  return {
    id: ev.id,
    source: 'its',
    kind: ev.kind,
    title,
    note: ev.message,
    start: ev.start || nowYmdHm,
    end: ev.end || `${nowYmdHm.slice(0, 10)}T23:59`,
    center: [ev.lat, ev.lng],
    radiusM: ev.kind === '행사' ? 300 : 150,
    // 차 길찾기에서: 전면 통제·행사는 거의 못 지나가게, 나머지(공사·사고 등)는 막히는 곳처럼 피해요
    level: ev.blocked || ev.kind === '행사' ? 'closed' : 'high',
  };
}

// ── 도로 속도 ─────────────────────────────────────────
// 같은 도로 이름이면 같은 길로 봐요 (띄어쓰기·괄호 무시)
export const roadKey = (name) => String(name || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim();

// 도시 도로 기준 소통 등급
export function speedGrade(kmh) {
  if (kmh >= 40) return { key: 'smooth', label: '원활' };
  if (kmh >= 25) return { key: 'slow', label: '서행' };
  if (kmh >= 15) return { key: 'delay', label: '지체' };
  return { key: 'jam', label: '정체' };
}

// 링크별 속도 → 도로 이름별 평균 (짧은 골목은 주차 때문에 0km/h가 나오기도 해서 0은 뺌)
export function aggregateSpeeds(rows) {
  const roads = new Map();
  let links = 0;
  let latest = null;
  for (const row of rows) {
    const speed = num(pick(row, 'speed', 'spd'));
    const travel = num(pick(row, 'travelTime', 'travel_time'));
    if (speed === null || (speed <= 0 && !travel)) continue;
    const name = String(pick(row, 'roadName', 'road_name', 'roadNm') || '').trim();
    const key = roadKey(name);
    if (!key) continue;
    links++;
    const t = itsTime(pick(row, 'createdDate', 'created_date', 'date'));
    if (t && (!latest || t > latest)) latest = t;
    const r = roads.get(key) || { name, key, sum: 0, n: 0, min: Infinity };
    r.sum += speed;
    r.n++;
    r.min = Math.min(r.min, speed);
    roads.set(key, r);
  }
  const list = [...roads.values()]
    .map((r) => {
      const kmh = Math.round((r.sum / r.n) * 10) / 10;
      return { name: r.name, key: r.key, kmh, min: r.min, links: r.n, grade: speedGrade(kmh).key };
    })
    .sort((a, b) => a.kmh - b.kmh);
  return { roads: list, links, updated: latest };
}
