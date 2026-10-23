// 경주 한산길 — 화면 동작
import { ZONES } from './data/zones.js';
import { ATTRACTIONS } from './data/attractions.js';
import { CLOSURES } from './data/closures.js';
import { scoreZone, activeClosures } from './lib/congestion.js';
import { kstNow, addDays, formatDay } from './lib/time.js';
import { isNearGyeongju, GYEONGJU_CENTER } from './lib/geo.js';

const $ = (id) => document.getElementById(id);
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6시 ~ 23시
const COLORS = { low: '#9CC79A', mid: '#F0C24B', high: '#E5823A', peak: '#B8323B' };
const BASE_WORD = { 1: '낮음', 2: '보통', 3: '높음' };
const AVOID_KEYS = ['mid', 'high', 'peak'];

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clampHour = (h) => Math.min(23, Math.max(6, h));
const fmtDist = (m) => (m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`);
const zoneById = (id) => ZONES.find((z) => z.id === id);
const areaName = (id) => zoneById(id)?.name || CLOSURES.find((c) => c.id === id)?.title || id;

const start = kstNow();
const state = {
  ymd: start.ymd,
  hour: clampHour(start.hour),
  forecast: null,
  config: null,
  from: null,
  to: null,
  pick: null,
  zoneId: null,
  route: null,
};

let kakao = null;
let map = null;
const drawn = { zones: {}, closures: [], routes: [], pins: {} };

// ── 혼잡도 ───────────────────────────────────────────
function levelsAt(ymd, hour) {
  return Object.fromEntries(ZONES.map((z) => [z.id, scoreZone(z, ymd, hour, state.forecast)]));
}

// ── 그리기 ───────────────────────────────────────────
function render() {
  renderWhen();
  renderGrid();
  renderClosures();
  renderMapZones();
  renderZoneCard();
  renderRouteResult();
}

function renderWhen() {
  const now = kstNow();
  $('dayLabel').textContent = formatDay(state.ymd);
  $('dateInput').value = state.ymd;
  $('hourInput').value = String(state.hour);
  $('hourLabel').textContent = `${state.hour}시`;
  const isNow = state.ymd === now.ymd && state.hour === clampHour(now.hour);
  $('nowBtn').setAttribute('aria-pressed', String(isNow));
}

function renderGrid() {
  const grid = $('grid');
  const frag = document.createDocumentFragment();

  frag.append(document.createElement('span'));
  for (const h of HOURS) {
    const s = document.createElement('span');
    s.className = 'hours';
    s.textContent = h % 3 === 0 ? String(h) : '';
    frag.append(s);
  }

  for (const z of ZONES) {
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'zname';
    name.textContent = z.short || z.name;
    name.title = z.name;
    name.setAttribute('aria-current', String(state.zoneId === z.id));
    name.addEventListener('click', () => selectZone(z.id, true));
    frag.append(name);

    for (const h of HOURS) {
      const r = scoreZone(z, state.ymd, h, state.forecast);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `cell ${r.level.key}${h === state.hour ? ' now' : ''}`;
      cell.title = `${z.name} ${h}시 · ${r.level.label}`;
      cell.setAttribute('aria-label', cell.title);
      cell.addEventListener('click', () => {
        state.hour = h;
        state.zoneId = z.id;
        render();
      });
      frag.append(cell);
    }
  }
  grid.replaceChildren(frag);

  const fc = state.forecast;
  $('source').textContent = fc?.ok
    ? `관광지 집중률 예측을 반영했어요 (경주 관광지 ${fc.names.length}곳 중 ${Object.keys(fc.zones).length}개 구역 연결).`
    : '평소 패턴과 월별 방문자 데이터로 추정했어요. 칸을 누르면 그 시간으로 바뀌어요.';
  if (fc && !fc.ok) $('source').title = fc.reason || '';
}

function renderClosures() {
  const active = activeClosures(CLOSURES, state.ymd, state.hour);
  const banner = $('closureBanner');
  if (!active.length) {
    banner.hidden = true;
  } else {
    banner.hidden = false;
    banner.innerHTML = active
      .map((c) => `<strong>${esc(c.title)}</strong>${esc(c.start.slice(11))}~${esc(c.end.slice(11))} ${esc(c.note || '')}`)
      .join('<br/>');
  }

  if (!map) return;
  drawn.closures.forEach((s) => s.setMap(null));
  drawn.closures = [];
  for (const c of active) {
    const center = new kakao.maps.LatLng(c.center[0], c.center[1]);
    const circle = new kakao.maps.Circle({
      center, radius: c.radiusM, strokeWeight: 3, strokeColor: COLORS.peak, strokeOpacity: 1,
      strokeStyle: 'shortdash', fillColor: COLORS.peak, fillOpacity: 0.08,
    });
    const tag = document.createElement('div');
    tag.className = 'closure-tag';
    tag.textContent = `통제: ${c.title}`;
    const overlay = new kakao.maps.CustomOverlay({ position: center, content: tag, yAnchor: 2.2 });
    circle.setMap(map);
    overlay.setMap(map);
    drawn.closures.push(circle, overlay);
  }
}

function renderMapZones() {
  if (!map) return;
  const levels = levelsAt(state.ymd, state.hour);
  for (const z of ZONES) {
    const lv = levels[z.id].level.key;
    const color = COLORS[lv];
    const selected = state.zoneId === z.id;
    let d = drawn.zones[z.id];
    if (!d) {
      const center = new kakao.maps.LatLng(z.center[0], z.center[1]);
      const circle = new kakao.maps.Circle({ center, radius: z.radiusM });
      const tag = document.createElement('div');
      tag.addEventListener('click', () => selectZone(z.id, false));
      const overlay = new kakao.maps.CustomOverlay({ position: center, content: tag, yAnchor: 0.5, clickable: true });
      kakao.maps.event.addListener(circle, 'click', () => selectZone(z.id, false));
      circle.setMap(map);
      overlay.setMap(map);
      d = drawn.zones[z.id] = { circle, tag };
    }
    d.circle.setOptions({
      strokeWeight: selected ? 4 : 2,
      strokeColor: color,
      strokeOpacity: 0.95,
      strokeStyle: 'solid',
      fillColor: color,
      fillOpacity: lv === 'low' ? 0.16 : 0.3,
    });
    d.tag.className = `zone-tag ${lv}`;
    d.tag.innerHTML = `${esc(z.name)}<b>${esc(levels[z.id].level.label)}</b>`;
  }
}

function renderZoneCard() {
  const card = $('zoneCard');
  const z = zoneById(state.zoneId);
  if (!z) { card.hidden = true; return; }
  card.hidden = false;

  const r = scoreZone(z, state.ymd, state.hour, state.forecast);
  const w = r.why;
  const why = [
    w.baseLevel ? `${w.dayType} ${w.slot} 평소 '${BASE_WORD[w.baseLevel]}'` : '심야 시간',
    `${w.month}월 방문객 ×${w.seasonRaw.toFixed(2)}`,
    w.forecastRate !== null ? `이날 집중률 예측 ${Math.round(w.forecastRate)}` : null,
  ].filter(Boolean).join(', ');

  // 이 날 9~21시 중 가장 한산한 시간
  let best = null;
  for (let h = 9; h <= 21; h++) {
    const s = scoreZone(z, state.ymd, h, state.forecast).score;
    if (!best || s < best.score) best = { h, score: s };
  }

  const spots = ATTRACTIONS.filter((a) => a.zone === z.id);
  card.innerHTML = `
    <h3>${esc(z.name)}</h3>
    <span class="zone-level ${r.level.key}">${state.hour}시 ${esc(r.level.label)}</span>
    <p class="why">${esc(why)} → ${r.score}점</p>
    <p class="why">이날 가장 한산한 시간: ${best.h}시 (${esc(scoreZone(z, state.ymd, best.h, state.forecast).level.label)})</p>
    <ul class="spots">
      ${spots.map((a) => `
        <li class="spot">
          <div class="spot-head"><strong>${esc(a.name)}</strong><span>보통 ${a.stayMin}분 머물러요</span></div>
          <ul>${a.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
          <div class="spot-actions">
            <button type="button" class="chip" data-goto="${esc(a.id)}">여기로 길찾기</button>
            ${a.links.map((l) => `<a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}
          </div>
        </li>`).join('')}
    </ul>`;
  card.querySelectorAll('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = ATTRACTIONS.find((x) => x.id === b.dataset.goto);
      setPlace('to', { lat: a.position[0], lng: a.position[1], name: a.name });
      $('routeTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }),
  );
}

function selectZone(id, pan) {
  state.zoneId = id;
  render();
  const z = zoneById(id);
  if (pan && map && z) map.panTo(new kakao.maps.LatLng(z.center[0], z.center[1]));
}

// ── 장소 고르기 ───────────────────────────────────────
function setPlace(which, p) {
  state[which] = p;
  const input = $(which === 'from' ? 'fromInput' : 'toInput');
  input.value = p.name;
  input.classList.add('set');
  $(which === 'from' ? 'fromSuggest' : 'toSuggest').hidden = true;
  drawPin(which);
  updateRouteButton();
}

function clearPlace(which) {
  state[which] = null;
  $(which === 'from' ? 'fromInput' : 'toInput').classList.remove('set');
  drawPin(which);
  updateRouteButton();
}

function drawPin(which) {
  if (!map) return;
  drawn.pins[which]?.setMap(null);
  const p = state[which];
  if (!p) return;
  const el = document.createElement('div');
  el.className = `pin ${which}`;
  el.textContent = which === 'from' ? '출발' : '도착';
  const pin = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(p.lat, p.lng), content: el, yAnchor: 1.3, zIndex: 3,
  });
  pin.setMap(map);
  drawn.pins[which] = pin;
}

function updateRouteButton() {
  $('routeBtn').disabled = !(state.from && state.to);
}

function localMatches(q) {
  return ATTRACTIONS.filter((a) => a.name.replace(/\s/g, '').includes(q.replace(/\s/g, ''))).map((a) => ({
    name: a.name, sub: '주요 관광지', lat: a.position[0], lng: a.position[1],
  }));
}

function searchPlaces(q) {
  return new Promise((resolve) => {
    if (!kakao?.maps?.services) return resolve([]);
    const places = new kakao.maps.services.Places();
    places.keywordSearch(
      q,
      (data, status) => {
        if (status !== kakao.maps.services.Status.OK) return resolve([]);
        resolve(data.map((d) => ({
          name: d.place_name,
          sub: d.road_address_name || d.address_name,
          lat: Number(d.y),
          lng: Number(d.x),
        })));
      },
      { location: new kakao.maps.LatLng(GYEONGJU_CENTER[0], GYEONGJU_CENTER[1]), radius: 20000, size: 8 },
    );
  });
}

function wireSearch(which) {
  const input = $(which === 'from' ? 'fromInput' : 'toInput');
  const list = $(which === 'from' ? 'fromSuggest' : 'toSuggest');
  let timer = null;
  let seq = 0;

  input.addEventListener('input', () => {
    if (state[which]) clearPlace(which);
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 1) { list.hidden = true; return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      const results = [...localMatches(q), ...(await searchPlaces(q))].slice(0, 10);
      if (mine !== seq) return;
      if (!results.length) {
        list.innerHTML = `<li><button type="button" disabled>검색 결과가 없어요. 다른 이름으로 찾거나 "지도에서"로 고르세요.</button></li>`;
      } else {
        list.innerHTML = results
          .map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}<small>${esc(r.sub || '')}</small></button></li>`)
          .join('');
        list.querySelectorAll('[data-i]').forEach((b) =>
          b.addEventListener('click', () => setPlace(which, results[Number(b.dataset.i)])),
        );
      }
      list.hidden = false;
    }, 300);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') list.hidden = true; });
  document.addEventListener('click', (e) => {
    if (!list.contains(e.target) && e.target !== input) list.hidden = true;
  });
}

function setPickMode(which) {
  state.pick = state.pick === which ? null : which;
  document.querySelectorAll('[data-pick]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.pick === state.pick)),
  );
  const hint = $('pickHint');
  if (!state.pick) { hint.hidden = true; return; }
  if (!map) {
    state.pick = null;
    hint.hidden = true;
    alertRoute('지도가 아직 준비되지 않았어요. 장소를 검색해서 골라 주세요.');
    return;
  }
  hint.textContent = `지도를 눌러 ${state.pick === 'from' ? '출발' : '도착'} 지점을 고르세요`;
  hint.hidden = false;
  if (window.innerWidth < 900) $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function useMyLocation() {
  if (!navigator.geolocation) return alertRoute('이 브라우저는 위치 정보를 지원하지 않아요.');
  const btn = $('gpsBtn');
  btn.textContent = '찾는 중…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.textContent = '내 위치';
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, name: '내 위치' };
      if (!isNearGyeongju([p.lat, p.lng])) {
        alertRoute('지금 위치가 경주에서 멀어요. 출발지를 경주 안에서 검색해 주세요.');
        return;
      }
      setPlace('from', p);
      if (map) map.panTo(new kakao.maps.LatLng(p.lat, p.lng));
    },
    (err) => {
      btn.textContent = '내 위치';
      alertRoute(err.code === 1
        ? '위치 권한이 꺼져 있어요. 브라우저 주소창의 자물쇠 아이콘에서 위치를 허용해 주세요.'
        : '현재 위치를 찾지 못했어요. 출발지를 검색해 주세요.');
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

// ── 길찾기 ───────────────────────────────────────────
function alertRoute(msg) {
  $('routeResult').innerHTML = `<p class="error">${esc(msg)}</p>`;
}

async function findRoute() {
  if (!state.from || !state.to) return;
  if (state.config && !state.config.hasRouteKey) {
    return alertRoute('길찾기 키(GRAPHHOPPER_API_KEY)가 아직 설정되지 않았어요.');
  }
  const levels = levelsAt(state.ymd, state.hour);
  const avoid = ZONES
    .filter((z) => AVOID_KEYS.includes(levels[z.id].level.key))
    .map((z) => ({ id: z.id, level: levels[z.id].level.key }));
  for (const c of activeClosures(CLOSURES, state.ymd, state.hour)) avoid.push({ id: c.id, level: 'closed' });

  const btn = $('routeBtn');
  btn.disabled = true;
  btn.textContent = '찾는 중…';
  try {
    const r = await fetch('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { lat: state.from.lat, lng: state.from.lng },
        to: { lat: state.to.lat, lng: state.to.lng },
        avoid,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `서버 오류 (${r.status})`);
    state.route = { ...data, ymd: state.ymd, hour: state.hour, levels, avoid };
    drawRoute();
    renderRouteResult();
  } catch (e) {
    alertRoute(`길을 찾지 못했어요. ${e.message}`);
  } finally {
    btn.textContent = '한산한 길 찾기';
    updateRouteButton();
  }
}

function drawRoute() {
  if (!map || !state.route) return;
  drawn.routes.forEach((l) => l.setMap(null));
  drawn.routes = [];
  const { plain, smart } = state.route;
  const toPath = (coords) => coords.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng));
  const bounds = new kakao.maps.LatLngBounds();

  const lines = [];
  if (smart) {
    lines.push({ path: toPath(plain.coords), color: '#8A968F', weight: 4, style: 'shortdash', opacity: 0.9 });
    lines.push({ path: toPath(smart.coords), color: '#2F6F8F', weight: 6, style: 'solid', opacity: 0.95 });
  } else {
    lines.push({ path: toPath(plain.coords), color: '#2F6F8F', weight: 6, style: 'solid', opacity: 0.95 });
  }
  for (const l of lines) {
    const line = new kakao.maps.Polyline({
      path: l.path, strokeWeight: l.weight, strokeColor: l.color, strokeOpacity: l.opacity, strokeStyle: l.style,
    });
    line.setMap(map);
    drawn.routes.push(line);
    l.path.forEach((p) => bounds.extend(p));
  }
  if (!bounds.isEmpty()) map.setBounds(bounds, 40, 40, 40, 40);
}

function renderRouteResult() {
  const box = $('routeResult');
  const route = state.route;
  if (!route) return;
  const { plain, smart, warning, levels, avoid } = route;
  const main = smart || plain;
  const parts = [];

  parts.push(`<div class="result-main">${smart ? '한산한 길' : '걷는 길'} <span class="dist">${fmtDist(main.distanceM)} · 걸어서 ${main.minutes}분</span></div>`);

  if (smart) {
    const diff = smart.minutes - plain.minutes;
    parts.push(`<div class="result-line"><span class="swatch"></span>한산한 길 ${fmtDist(smart.distanceM)}, ${smart.minutes}분</div>`);
    parts.push(`<div class="result-line"><span class="swatch plain"></span>가장 짧은 길 ${fmtDist(plain.distanceM)}, ${plain.minutes}분${diff > 0 ? ` (한산한 길이 ${diff}분 더 걸려요)` : ''}</div>`);

    const label = (id) => {
      const lv = levels[id]?.level.label || '통제';
      return `${areaName(id)}(${lv})`;
    };
    const avoided = plain.passes.filter((id) => !smart.passes.includes(id) && avoid.some((a) => a.id === id));
    const still = smart.passes.filter((id) => avoid.some((a) => a.id === id));
    if (avoided.length) parts.push(`<p class="avoided">피해 가는 곳: ${avoided.map((id) => esc(label(id))).join(', ')}</p>`);
    else if (!still.length) parts.push(`<p class="avoided">가장 짧은 길도 혼잡한 구역을 지나지 않아요.</p>`);
    if (still.length) parts.push(`<p class="avoided">출발지나 도착지가 안쪽이라 지나가는 곳: ${still.map((id) => esc(label(id))).join(', ')}</p>`);
  } else if (!avoid.length) {
    parts.push(`<p class="avoided">이 시간엔 피할 만큼 붐비는 구역이 없어서 가장 짧은 길로 안내해요.</p>`);
  }

  if (warning) parts.push(`<p class="warn">${esc(warning)}</p>`);
  if (route.ymd !== state.ymd || route.hour !== state.hour) {
    parts.push(`<p class="warn">고른 시간이 바뀌었어요. 다시 찾으면 ${state.hour}시 혼잡도로 계산해요.</p>`);
  }
  if (main.instructions.length) {
    parts.push(`<details class="steps"><summary>걷는 순서 보기 (${main.instructions.length}단계)</summary><ol>${main.instructions
      .map((i) => `<li>${esc(i.text)}${i.distanceM ? `<span>${fmtDist(i.distanceM)}</span>` : ''}</li>`)
      .join('')}</ol></details>`);
  }
  box.innerHTML = parts.join('');
}

// ── 지도 불러오기 ─────────────────────────────────────
function showMapNotice(msg) {
  const n = $('mapNotice');
  n.textContent = msg;
  n.hidden = false;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('script'));
    document.head.append(s);
  });
}

async function initMap() {
  const key = state.config?.kakaoJsKey;
  if (!key) {
    showMapNotice('카카오맵 키(KAKAO_JS_KEY)가 설정되면 여기에 지도가 나와요. 아래 시간표와 길찾기는 지금도 볼 수 있어요.');
    return;
  }
  try {
    await loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 10000);
      window.kakao.maps.load(() => { clearTimeout(t); resolve(); });
    });
  } catch {
    showMapNotice(`카카오 지도를 불러오지 못했어요. 카카오 개발자 콘솔 → 앱 → 플랫폼 키 → JavaScript SDK 도메인에 ${location.origin} 이 등록돼 있는지 확인해 주세요.`);
    return;
  }
  kakao = window.kakao;
  map = new kakao.maps.Map($('map'), {
    center: new kakao.maps.LatLng(35.8335, 129.2350),
    level: 7,
  });
  kakao.maps.event.addListener(map, 'click', (e) => {
    if (!state.pick) return;
    const which = state.pick;
    setPlace(which, { lat: e.latLng.getLat(), lng: e.latLng.getLng(), name: '지도에서 고른 곳' });
    setPickMode(which); // 끄기
  });
  window.addEventListener('resize', () => map.relayout());
  render();
  drawPin('from');
  drawPin('to');
  drawRoute();
}

// ── 시작 ─────────────────────────────────────────────
function wire() {
  $('prevDay').addEventListener('click', () => { state.ymd = addDays(state.ymd, -1); render(); });
  $('nextDay').addEventListener('click', () => { state.ymd = addDays(state.ymd, 1); render(); });
  $('dateInput').addEventListener('change', (e) => { if (e.target.value) { state.ymd = e.target.value; render(); } });
  $('hourInput').addEventListener('input', (e) => { state.hour = Number(e.target.value); render(); });
  $('nowBtn').addEventListener('click', () => {
    const now = kstNow();
    state.ymd = now.ymd;
    state.hour = clampHour(now.hour);
    render();
  });
  $('gpsBtn').addEventListener('click', useMyLocation);
  document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => setPickMode(b.dataset.pick)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.pick) setPickMode(state.pick); });
  $('routeBtn').addEventListener('click', findRoute);
  wireSearch('from');
  wireSearch('to');

  const quick = $('quickTo');
  for (const a of ATTRACTIONS.slice(0, 8)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = a.name;
    b.addEventListener('click', () => {
      setPlace('to', { lat: a.position[0], lng: a.position[1], name: a.name });
      if (a.zone) { state.zoneId = a.zone; render(); }
    });
    quick.append(b);
  }
}

async function boot() {
  wire();
  render();
  const [config, forecast] = await Promise.all([
    fetch('/api/config').then((r) => r.json()).catch(() => null),
    fetch('/api/forecast').then((r) => r.json()).catch(() => null),
  ]);
  state.config = config || { kakaoJsKey: '', hasRouteKey: false, hasForecastKey: false };
  state.forecast = forecast;
  render();
  initMap();
}

boot();
