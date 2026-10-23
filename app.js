// 경주 한산길 — 화면 동작
import { ZONES } from './data/zones.js';
import { ATTRACTIONS } from './data/attractions.js';
import { PLACES } from './data/places.js';
import { CLOSURES } from './data/closures.js';
import { scoreZone, activeClosures } from './lib/congestion.js';
import { kstNow, addDays, formatDay } from './lib/time.js';
import { isNearGyeongju, GYEONGJU_CENTER, distanceM, areaCenter, areaContains } from './lib/geo.js';
import { rankTransit, walkMinutes } from './lib/transit.js';

const $ = (id) => document.getElementById(id);
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 6시 ~ 23시
const COLORS = { low: '#9CC79A', mid: '#F0C24B', high: '#E5823A', peak: '#B8323B' };
const BASE_WORD = { 1: '낮음', 2: '보통', 3: '높음' };
const AVOID_KEYS = ['mid', 'high', 'peak'];
const DRAW_MODE = new URLSearchParams(location.search).has('draw'); // 주소 뒤에 ?draw → 구역 그리기 도구

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
  routes: { walk: null, car: null }, // 걸어서·차 경로 결과
  mode: 'walk', // 'walk' | 'bus' | 'car'
  region: null, // 관광지 둘러보기에서 고른 권역
  place: null, // 고른 관광지 { ...PLACES 항목, pos: [위도, 경도] | null, loading }
  transit: null,
};

let kakao = null;
let map = null;
const drawn = { zones: {}, closures: [], routes: [], pins: {}, marks: [], draft: [] };
const draft = []; // 구역 그리기로 찍은 점 [위도, 경도]
let lastShapeClick = 0;

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
  renderPlaceCard();
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
    const [clat, clng] = areaCenter(c);
    const center = new kakao.maps.LatLng(clat, clng);
    const circle = makeShape(c, {
      strokeWeight: 3, strokeColor: COLORS.peak, strokeOpacity: 1,
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

// 구역 모양 그리기: polygon이 있으면 다각형, 없으면 원
function makeShape(area, style = {}) {
  if (area.polygon?.length >= 3) {
    return new kakao.maps.Polygon({
      path: area.polygon.map(([lat, lng]) => new kakao.maps.LatLng(lat, lng)),
      ...style,
    });
  }
  return new kakao.maps.Circle({
    center: new kakao.maps.LatLng(area.center[0], area.center[1]),
    radius: area.radiusM,
    ...style,
  });
}

// 구역 위를 눌렀을 때: 장소 고르기·구역 그리기 중이면 그 지점을 쓰고, 아니면 구역 정보 열기
function onShapeClick(e, zoneId) {
  lastShapeClick = Date.now();
  if ((state.pick || DRAW_MODE) && e?.latLng) return onPointClick(e.latLng);
  if (zoneId) selectZone(zoneId, false);
}

function onPointClick(latLng) {
  if (state.pick) {
    const which = state.pick;
    setPlace(which, { lat: latLng.getLat(), lng: latLng.getLng(), name: '지도에서 고른 곳' });
    setPickMode(which); // 끄기
    return;
  }
  if (DRAW_MODE) addDraftPoint(latLng.getLat(), latLng.getLng());
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
      const [clat, clng] = areaCenter(z);
      const center = new kakao.maps.LatLng(clat, clng);
      const circle = makeShape(z);
      const tag = document.createElement('div');
      tag.addEventListener('click', () => { if (!state.pick && !DRAW_MODE) selectZone(z.id, false); });
      const overlay = new kakao.maps.CustomOverlay({ position: center, content: tag, yAnchor: 0.5, clickable: true });
      kakao.maps.event.addListener(circle, 'click', (e) => onShapeClick(e, z.id));
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
  if (pan && map && z) {
    const [lat, lng] = areaCenter(z);
    map.panTo(new kakao.maps.LatLng(lat, lng));
  }
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
  const btn = $('routeBtn');
  btn.disabled = !(state.from && state.to);
  btn.textContent = { walk: '한산한 길 찾기', bus: '버스 경로 찾기', car: '덜 막히는 길 찾기' }[state.mode];
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  updateRouteButton();
  $('routeResult').innerHTML = '';
  drawRoute();
  renderRouteResult();
}

function localMatches(q) {
  const nq = q.replace(/\s/g, '');
  const main = ATTRACTIONS.filter((a) => a.name.replace(/\s/g, '').includes(nq)).map((a) => ({
    name: a.name, sub: '주요 관광지', lat: a.position[0], lng: a.position[1],
  }));
  const more = PLACES.filter((p) => p.name.replace(/\s/g, '').includes(nq) && !attractionFor(p.name)).map((p) => ({
    name: p.name, sub: `${p.region} · ${p.address}`, place: p,
  }));
  return [...main, ...more];
}

// ── 관광지 둘러보기 (경주시 관광지 158곳) ─────────────────
const REGIONS = [...new Set(PLACES.map((p) => p.region))];
const placePos = new Map(); // 이번 방문 동안만 기억 (카카오 정책상 파일로 저장하지 않음)
const norm = (s) => String(s).replace(/\s|경주/g, '');

function attractionFor(name) {
  const n = norm(name);
  return ATTRACTIONS.find((a) => norm(a.name) === n || a.name.split('·').some((part) => norm(part) === n));
}

function geocodeAddress(address) {
  return new Promise((resolve) => {
    if (!kakao?.maps?.services) return resolve(null);
    new kakao.maps.services.Geocoder().addressSearch(address, (res, status) => {
      resolve(status === kakao.maps.services.Status.OK && res[0] ? [Number(res[0].y), Number(res[0].x)] : null);
    });
  });
}

// 이름으로 먼저 찾고(입구 위치가 더 정확), 안 되면 주소로, 그래도 안 되면 직접 넣어둔 위치
async function locatePlace(p) {
  if (placePos.has(p.name)) return placePos.get(p.name);
  let pos = null;
  const hits = await searchPlaces(`경주 ${p.name}`, false);
  const near = hits.find((h) => isNearGyeongju([h.lat, h.lng], 40));
  if (near) pos = [near.lat, near.lng];
  if (!pos) pos = await geocodeAddress(p.address);
  if (!pos) pos = attractionFor(p.name)?.position || null;
  placePos.set(p.name, pos);
  return pos;
}

async function openPlace(p) {
  state.place = { ...p, pos: null, loading: true };
  renderPlaceCard();
  $('placeCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const pos = await locatePlace(p);
  if (state.place?.name !== p.name) return; // 그사이 다른 곳을 눌렀으면 무시
  state.place = { ...p, pos, loading: false };
  renderPlaceCard();
  drawPlacePin();
  if (map && pos) map.panTo(new kakao.maps.LatLng(pos[0], pos[1]));
}

function drawPlacePin() {
  if (!map) return;
  drawn.placePin?.setMap(null);
  const pos = state.place?.pos;
  if (!pos) return;
  const el = document.createElement('div');
  el.className = 'pin place';
  el.textContent = state.place.name;
  drawn.placePin = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(pos[0], pos[1]), content: el, yAnchor: 1.3, zIndex: 3 });
  drawn.placePin.setMap(map);
}

function renderBrowse() {
  if (!state.region) state.region = REGIONS[0];
  const tabs = $('regionTabs');
  tabs.replaceChildren(...REGIONS.map((r) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = `${r} ${PLACES.filter((p) => p.region === r).length}`;
    b.setAttribute('aria-pressed', String(r === state.region));
    b.addEventListener('click', () => { state.region = r; renderBrowse(); });
    return b;
  }));
  const list = $('placeList');
  list.replaceChildren(...PLACES.filter((p) => p.region === state.region).map((p) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = attractionFor(p.name) ? 'place-item has-info' : 'place-item';
    b.textContent = p.name;
    b.title = p.address;
    b.addEventListener('click', () => openPlace(p));
    li.append(b);
    return li;
  }));
}

function renderPlaceCard() {
  const card = $('placeCard');
  const p = state.place;
  if (!p) { card.hidden = true; return; }
  card.hidden = false;
  const a = attractionFor(p.name);
  const parts = [`<h3>${esc(p.name)}</h3><p class="why">${esc(p.region)} · ${esc(p.address)}${p.phone ? ` · <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ''}</p>`];

  if (p.loading) parts.push('<p class="why">위치 찾는 중…</p>');
  else if (!p.pos) parts.push('<p class="why">지도에서 위치를 찾지 못했어요. 카카오맵에서 확인해 주세요.</p>');
  else {
    const zone = ZONES.find((z) => areaContains(z, p.pos));
    if (zone) {
      const r = scoreZone(zone, state.ymd, state.hour, state.forecast);
      parts.push(`<p><span class="zone-level ${r.level.key}">${state.hour}시 ${esc(r.level.label)}</span> <span class="why">${esc(zone.name)} 구역 안이에요.</span></p>`);
    } else {
      parts.push('<p class="why">혼잡 구역 밖이라 혼잡도 정보가 아직 없어요.</p>');
    }
  }
  if (a) {
    parts.push(`<p class="why">보통 ${a.stayMin}분 머물러요</p><ul class="spot-points">${a.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`);
  }
  const links = (a?.links || []).filter((l) => !l.url.includes('map.kakao.com'));
  parts.push(`<div class="spot-actions">
    ${p.pos ? '<button type="button" class="chip" data-place-go>여기로 길찾기</button>' : ''}
    <a class="chip" href="https://map.kakao.com/link/search/${encodeURIComponent(`경주 ${p.name}`)}" target="_blank" rel="noopener">카카오맵에서 보기</a>
    ${links.map((l) => `<a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}
  </div>`);
  card.innerHTML = parts.join('');
  card.querySelector('[data-place-go]')?.addEventListener('click', () => {
    setPlace('to', { lat: p.pos[0], lng: p.pos[1], name: p.name });
    $('routeTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function searchPlaces(q, nearbyOnly = true) {
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
      nearbyOnly
        ? { location: new kakao.maps.LatLng(GYEONGJU_CENTER[0], GYEONGJU_CENTER[1]), radius: 20000, size: 8 }
        : { location: new kakao.maps.LatLng(GYEONGJU_CENTER[0], GYEONGJU_CENTER[1]), size: 5 },
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
          b.addEventListener('click', async () => {
            const r = results[Number(b.dataset.i)];
            if (r.place) {
              input.value = `${r.name} (위치 찾는 중…)`;
              const pos = await locatePlace(r.place);
              if (!pos) { input.value = r.name; alertRoute(`${r.name}의 위치를 찾지 못했어요. 다른 이름으로 검색해 주세요.`); return; }
              setPlace(which, { name: r.name, lat: pos[0], lng: pos[1] });
            } else {
              setPlace(which, r);
            }
          }),
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
  return state.mode === 'bus' ? findTransit() : findPathRoute(state.mode);
}

// 걸어서·차: GraphHopper로 일반 경로 + 혼잡 회피 경로
async function findPathRoute(mode) {
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
        profile: mode === 'car' ? 'car' : 'foot',
        avoid,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `서버 오류 (${r.status})`);
    state.routes[mode] = { ...data, ymd: state.ymd, hour: state.hour, levels, avoid };
    drawRoute();
    renderRouteResult();
  } catch (e) {
    alertRoute(`길을 찾지 못했어요. ${e.message}`);
  } finally {
    updateRouteButton();
  }
}

async function findTransit() {
  if (state.config && !state.config.hasTransitKey) {
    return alertRoute('버스 경로 키(KAKAO_REST_KEY)가 아직 설정되지 않았어요.');
  }
  const btn = $('routeBtn');
  btn.disabled = true;
  btn.textContent = '찾는 중…';
  try {
    const r = await fetch('/api/transit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { lat: state.from.lat, lng: state.from.lng, name: state.from.name },
        to: { lat: state.to.lat, lng: state.to.lng, name: state.to.name },
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `서버 오류 (${r.status})`);
    const levels = levelsAt(state.ymd, state.hour);
    const closureIds = activeClosures(CLOSURES, state.ymd, state.hour).map((c) => c.id);
    state.transit = {
      ranked: rankTransit(data.routes || [], levels, closureIds),
      message: data.message || null,
      landingURL: data.landingURL || null,
      levels,
      ymd: state.ymd,
      hour: state.hour,
      selected: 0,
      from: state.from,
      to: state.to,
    };
    drawRoute();
    renderRouteResult();
  } catch (e) {
    alertRoute(`버스 경로를 찾지 못했어요. ${e.message}`);
  } finally {
    updateRouteButton();
  }
}

function clearRouteDrawing() {
  drawn.routes.forEach((l) => l.setMap(null));
  drawn.marks.forEach((m) => m.setMap(null));
  drawn.routes = [];
  drawn.marks = [];
}

function drawRoute() {
  if (!map) return;
  clearRouteDrawing();
  if (state.mode === 'bus') return drawTransit();
  const route = state.routes[state.mode];
  if (!route) return;
  const { plain, smart } = route;
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

function drawTransit() {
  const t = state.transit;
  const r = t?.ranked[t.selected];
  if (!r) return;
  const LL = (lat, lng) => new kakao.maps.LatLng(lat, lng);
  const bounds = new kakao.maps.LatLngBounds();
  const addLine = (path, ride) => {
    if (path.length < 2) return;
    const line = new kakao.maps.Polyline({
      path,
      strokeWeight: ride ? 6 : 4,
      strokeColor: ride ? '#2F6F8F' : '#8A968F',
      strokeOpacity: 0.95,
      strokeStyle: ride ? 'solid' : 'shortdash',
    });
    line.setMap(map);
    drawn.routes.push(line);
    path.forEach((p) => bounds.extend(p));
  };

  const all = r.steps.flatMap((s) => s.coords);
  if (all.length) {
    addLine([LL(t.from.lat, t.from.lng), LL(all[0][1], all[0][0])], false);
    const last = all[all.length - 1];
    addLine([LL(last[1], last[0]), LL(t.to.lat, t.to.lng)], false);
  }
  for (const s of r.steps) {
    const ride = s.type !== 'WALKING';
    addLine(s.coords.map(([lng, lat]) => LL(lat, lng)), ride);
    if (ride && s.coords.length) {
      const el = document.createElement('div');
      el.className = 'board-tag';
      el.textContent = `${busNames(s)} 승차`;
      const o = new kakao.maps.CustomOverlay({ position: LL(s.coords[0][1], s.coords[0][0]), content: el, yAnchor: 1.4, zIndex: 2 });
      o.setMap(map);
      drawn.marks.push(o);
    }
  }
  if (!bounds.isEmpty()) map.setBounds(bounds, 40, 40, 40, 40);
}

const busNames = (step) => {
  const names = [...new Set(step.vehicles.map((v) => v.name).filter(Boolean))];
  if (!names.length) return step.type === 'SUBWAY' ? '지하철' : '버스';
  return names.length > 3 ? `${names.slice(0, 3).join('·')} 외` : names.join('·');
};

function renderTransitResult() {
  const box = $('routeResult');
  const t = state.transit;
  if (!t) { box.innerHTML = ''; return; }
  const parts = [];

  if (!t.ranked.length) {
    parts.push(`<p class="avoided">${esc(t.message || '버스 경로를 찾지 못했어요.')}</p>`);
  } else {
    const label = (x) => `${areaName(x.id)}(${x.level === 'closed' ? '통제' : t.levels[x.id]?.level.label || ''})`;
    parts.push('<ol class="transit-list">');
    t.ranked.forEach((r, k) => {
      const ride = r.steps.filter((s) => s.type !== 'WALKING');
      const chain = ride.map((s) => `<span class="busno">${esc(busNames(s))}</span>`).join('<span class="arrow">›</span>');
      const meta = [`환승 ${r.transfers}회`, `걷기 약 ${r.walkMin + r.steps.filter((s) => s.type === 'WALKING').reduce((a, s) => a + s.minutes, 0)}분`];
      if (r.fare) meta.push(`${r.fare.toLocaleString()}원`);
      parts.push(`<li><button type="button" class="troute" data-k="${k}" aria-pressed="${k === t.selected}">
        <span class="thead"><span class="ttime">${r.total}분</span>${k === 0 ? '<span class="badge">추천</span>' : ''}<span class="tmeta">${meta.join(' · ')}</span></span>
        <span class="tchain">${chain}</span>
        ${ride[0]?.from ? `<span class="tstops">${esc(ride[0].from)} 승차 → ${esc(ride[ride.length - 1].to || '')} 하차</span>` : ''}
        ${r.risks.length ? `<span class="risk">지나가는 혼잡 구역: ${r.risks.map((x) => esc(label(x))).join(', ')}. 막히면 ${r.delay}분쯤 늦어질 수 있어요.</span>` : ''}
      </button></li>`);
    });
    parts.push('</ol>');

    const sel = t.ranked[t.selected];
    const steps = [];
    const firstStop = sel.steps.find((s) => s.type !== 'WALKING')?.from;
    steps.push(`<li>${esc(firstStop || '첫 정류장')}까지 걷기<span>약 ${walkMinutes(sel.walkStartM)}분</span></li>`);
    for (const s of sel.steps) {
      if (s.type === 'WALKING') {
        if (s.minutes > 0) steps.push(`<li>환승하러 걷기<span>${s.minutes}분</span></li>`);
      } else {
        steps.push(`<li><strong>${esc(busNames(s))}</strong> ${esc(s.from || '')} → ${esc(s.to || '')}<span>${s.stopCount ? `${s.stopCount}정류장, ` : ''}${s.minutes}분</span></li>`);
      }
    }
    steps.push(`<li>내려서 도착지까지 걷기<span>약 ${walkMinutes(sel.walkEndM)}분</span></li>`);
    parts.push(`<details class="steps" open><summary>${t.selected === 0 ? '추천 경로' : '고른 경로'} 타는 순서</summary><ol>${steps.join('')}</ol></details>`);

    const straight = distanceM([t.from.lat, t.from.lng], [t.to.lat, t.to.lng]);
    const walkOnly = walkMinutes(straight);
    if (walkOnly <= t.ranked[0].total) {
      parts.push(`<p class="avoided">걸어서 가면 약 ${walkOnly}분이라 걷는 게 더 빠를 수 있어요.</p>`);
    }
  }

  parts.push(`<p class="why">버스 배차 간격과 실시간 도착 정보는 아직 반영되지 않았어요.${t.landingURL ? ` <a href="${esc(t.landingURL)}" target="_blank" rel="noopener">카카오맵에서 확인하기</a>` : ''}</p>`);
  if (t.ymd !== state.ymd || t.hour !== state.hour) {
    parts.push(`<p class="warn">고른 시간이 바뀌었어요. 다시 찾으면 ${state.hour}시 혼잡도로 추천 순서를 다시 정해요.</p>`);
  }
  box.innerHTML = parts.join('');
  box.querySelectorAll('[data-k]').forEach((b) =>
    b.addEventListener('click', () => {
      t.selected = Number(b.dataset.k);
      drawRoute();
      renderTransitResult();
    }),
  );
}

function renderRouteResult() {
  if (state.mode === 'bus') return renderTransitResult();
  const box = $('routeResult');
  const route = state.routes[state.mode];
  if (!route) return;
  const car = state.mode === 'car';
  const W = car
    ? { smart: '덜 막히는 길', plain: '가장 빠른 길', only: '차로 가는 길', how: '차로', steps: '가는 순서 보기' }
    : { smart: '한산한 길', plain: '가장 짧은 길', only: '걷는 길', how: '걸어서', steps: '걷는 순서 보기' };
  const { plain, smart, warning, levels, avoid } = route;
  const main = smart || plain;
  const parts = [];

  parts.push(`<div class="result-main">${smart ? W.smart : W.only} <span class="dist">${fmtDist(main.distanceM)} · ${W.how} ${main.minutes}분</span></div>`);

  if (smart) {
    const diff = smart.minutes - plain.minutes;
    parts.push(`<div class="result-line"><span class="swatch"></span>${W.smart} ${fmtDist(smart.distanceM)}, ${smart.minutes}분</div>`);
    parts.push(`<div class="result-line"><span class="swatch plain"></span>${W.plain} ${fmtDist(plain.distanceM)}, ${plain.minutes}분${diff > 0 ? ` (${W.smart}이 ${diff}분 더 걸려요)` : ''}</div>`);

    const label = (id) => {
      const lv = levels[id]?.level.label || '통제';
      return `${areaName(id)}(${lv})`;
    };
    const avoided = plain.passes.filter((id) => !smart.passes.includes(id) && avoid.some((a) => a.id === id));
    const still = smart.passes.filter((id) => avoid.some((a) => a.id === id));
    if (avoided.length) parts.push(`<p class="avoided">피해 가는 곳: ${avoided.map((id) => esc(label(id))).join(', ')}</p>`);
    else if (!still.length) parts.push(`<p class="avoided">${W.plain}도 혼잡한 구역을 지나지 않아요.</p>`);
    if (still.length) parts.push(`<p class="avoided">출발지나 도착지가 안쪽이라 지나가는 곳: ${still.map((id) => esc(label(id))).join(', ')}</p>`);
  } else if (!avoid.length) {
    parts.push(`<p class="avoided">이 시간엔 피할 만큼 붐비는 구역이 없어서 ${W.plain}로 안내해요.</p>`);
  } else if (!route.note) {
    const label = (id) => `${areaName(id)}(${levels[id]?.level.label || '통제'})`;
    const still = plain.passes.filter((id) => avoid.some((a) => a.id === id));
    parts.push(still.length
      ? `<p class="avoided">출발지나 도착지가 안쪽이라 지나가는 곳: ${still.map((id) => esc(label(id))).join(', ')}</p>`
      : `<p class="avoided">${W.plain}도 혼잡한 구역을 지나지 않아요.</p>`);
  }
  if (car) {
    parts.push(`<p class="why">차 경로는 혼잡 구역·통제 일정만 반영해요. 실시간 도로 속도는 교통소통정보 연결 후 반영할 예정이에요. 주차장은 따로 확인해 주세요.</p>`);
  }

  if (route.note) parts.push(`<p class="avoided">${esc(route.note)}</p>`);
  if (warning) parts.push(`<p class="warn">${esc(warning)}</p>`);
  if (route.ymd !== state.ymd || route.hour !== state.hour) {
    parts.push(`<p class="warn">고른 시간이 바뀌었어요. 다시 찾으면 ${state.hour}시 혼잡도로 계산해요.</p>`);
  }
  if (main.instructions.length) {
    parts.push(`<details class="steps"><summary>${W.steps} (${main.instructions.length}단계)</summary><ol>${main.instructions
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
    if (Date.now() - lastShapeClick < 300) return; // 구역 위를 누른 건 이미 처리함
    onPointClick(e.latLng);
  });
  if (DRAW_MODE) setupDrawTool();
  window.addEventListener('resize', () => map.relayout());
  render();
  drawPin('from');
  drawPin('to');
  drawRoute();
  drawPlacePin();
}

// ── 구역 그리기 도구 (주소 뒤에 ?draw) ────────────────────
function setupDrawTool() {
  const panel = document.createElement('div');
  panel.className = 'draw-panel';
  panel.innerHTML = `
    <strong>구역 그리기</strong>
    <p>지도를 눌러 구역 꼭짓점을 차례로 찍으세요. 지금 <b id="draftCount">0</b>개</p>
    <div class="draw-actions">
      <button type="button" class="chip" id="draftUndo">하나 지우기</button>
      <button type="button" class="chip" id="draftClear">처음부터</button>
      <button type="button" class="chip" id="draftCopy">좌표 복사</button>
    </div>
    <textarea id="draftOut" rows="4" readonly placeholder="점을 3개 이상 찍으면 여기에 좌표가 나와요."></textarea>
    <p class="draw-help" id="draftMsg">복사한 내용을 data/zones.js 의 그 구역 polygon 자리에 붙여넣으면 돼요.</p>`;
  document.querySelector('.map-wrap').append(panel);
  $('draftUndo').addEventListener('click', () => { draft.pop(); renderDraft(); });
  $('draftClear').addEventListener('click', () => { draft.length = 0; renderDraft(); });
  $('draftCopy').addEventListener('click', async () => {
    const text = $('draftOut').value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      $('draftMsg').textContent = '복사했어요. data/zones.js 의 그 구역 polygon 자리에 붙여넣으세요.';
    } catch {
      $('draftOut').select();
      $('draftMsg').textContent = '자동 복사가 막혀 있어요. 글자가 선택돼 있으니 Ctrl+C 를 눌러 주세요.';
    }
  });
  renderDraft();
}

function addDraftPoint(lat, lng) {
  draft.push([+lat.toFixed(5), +lng.toFixed(5)]);
  renderDraft();
}

function renderDraft() {
  drawn.draft.forEach((x) => x.setMap(null));
  drawn.draft = [];
  $('draftCount').textContent = String(draft.length);
  $('draftOut').value = draft.length >= 3
    ? `polygon: [\n${draft.map(([a, b]) => `  [${a.toFixed(5)}, ${b.toFixed(5)}],`).join('\n')}\n],`
    : '';
  if (!map || !draft.length) return;
  const path = draft.map(([a, b]) => new kakao.maps.LatLng(a, b));
  const style = { strokeWeight: 3, strokeColor: '#1C2B25', strokeOpacity: 1, strokeStyle: 'solid' };
  const shape = draft.length >= 3
    ? new kakao.maps.Polygon({ path, ...style, fillColor: '#1C2B25', fillOpacity: 0.12 })
    : new kakao.maps.Polyline({ path, ...style });
  shape.setMap(map);
  drawn.draft.push(shape);
  draft.forEach(([a, b], i) => {
    const dot = document.createElement('div');
    dot.className = 'draft-dot';
    dot.textContent = String(i + 1);
    const o = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(a, b), content: dot, zIndex: 4 });
    o.setMap(map);
    drawn.draft.push(o);
  });
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
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
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
  renderBrowse();
  render();
  const [config, forecast] = await Promise.all([
    fetch('/api/config').then((r) => r.json()).catch(() => null),
    fetch('/api/forecast').then((r) => r.json()).catch(() => null),
  ]);
  state.config = config || { kakaoJsKey: '', hasRouteKey: false, hasTransitKey: false, hasForecastKey: false };
  state.forecast = forecast;
  render();
  initMap();
}

boot();
