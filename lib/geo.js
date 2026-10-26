// 거리·도형 계산 (화면과 서버가 같이 씀)

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

// 두 지점 사이 거리(미터). a, b = [위도, 경도]
export function distanceM(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 원을 다각형으로 바꿈 (GraphHopper 회피 구역용). 결과 좌표는 [경도, 위도]
export function circlePolygon(center, radiusM, steps = 24) {
  const [lat, lng] = center;
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const dLat = (radiusM * Math.cos(t)) / R;
    const dLng = (radiusM * Math.sin(t)) / (R * Math.cos(rad(lat)));
    ring.push([+(lng + (dLng * 180) / Math.PI).toFixed(6), +(lat + (dLat * 180) / Math.PI).toFixed(6)]);
  }
  ring[ring.length - 1] = ring[0];
  return ring;
}

// ── 구역 모양 ─────────────────────────────────────────
// 구역은 두 가지 모양 중 하나예요.
//   다각형: polygon: [[위도, 경도], [위도, 경도], ...]  (꼭짓점 3개 이상)
//   원    : center: [위도, 경도], radiusM: 반경(미터)

export function pointInPolygon([lat, lng], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function areaContains(area, point) {
  if (area.polygon?.length >= 3) return pointInPolygon(point, area.polygon);
  return distanceM(point, area.center) <= area.radiusM;
}

// 지도 이름표를 붙일 가운데 지점 [위도, 경도]
export function areaCenter(area) {
  if (area.polygon?.length >= 3) {
    const n = area.polygon.length;
    return [area.polygon.reduce((a, p) => a + p[0], 0) / n, area.polygon.reduce((a, p) => a + p[1], 0) / n];
  }
  return area.center;
}

// GraphHopper에 보낼 외곽선 [[경도, 위도], ...] (처음과 끝 점이 같음)
export function areaRing(area) {
  if (area.polygon?.length >= 3) {
    const ring = area.polygon.map(([lat, lng]) => [lng, lat]);
    ring.push(ring[0]);
    return ring;
  }
  return circlePolygon(area.center, area.radiusM);
}

// 경로(좌표 [경도, 위도] 목록)를 25m 간격 이하로 촘촘하게 (긴 직선 구간이 작은 구역을 건너뛰지 않게)
export function densify(coords, stepM = 25) {
  if (coords.length < 2) return coords.slice();
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    const n = Math.ceil(distanceM([lat1, lng1], [lat2, lng2]) / stepM);
    for (let k = 1; k <= n; k++) out.push([lng1 + ((lng2 - lng1) * k) / n, lat1 + ((lat2 - lat1) * k) / n]);
  }
  return out;
}

// 경로(좌표 [경도, 위도] 목록)가 지나가는 구역들의 id
export function areasOnPath(coords, areas) {
  const hit = new Set();
  for (const [lng, lat] of densify(coords)) {
    for (const a of areas) {
      if (!hit.has(a.id) && areaContains(a, [lat, lng])) hit.add(a.id);
    }
  }
  return [...hit];
}

// 경주 근처인지 (현재 위치 확인용)
export const GYEONGJU_CENTER = [35.8355, 129.2247];
export function isNearGyeongju(point, maxKm = 30) {
  return distanceM(point, GYEONGJU_CENTER) <= maxKm * 1000;
}
