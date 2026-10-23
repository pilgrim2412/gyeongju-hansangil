// 버스 경로 추천 순서 계산
// ─────────────────────────────────────────────────────────────
// 카카오가 준 소요시간에, 버스가 혼잡 구역·통제 구역을 지나가면
// 막혀서 늦어질 수 있는 시간을 더해서 추천 순서를 정해요.
// 지연 시간은 감으로 정한 값이라, 교통소통정보 API가 승인되면
// 실제 도로 속도로 바꿀 예정이에요.
// ─────────────────────────────────────────────────────────────

const WALK_M_PER_MIN = 70; // 걷는 속도 (분당 70m ≈ 시속 4.2km)
const DETOUR = 1.3;        // 직선거리보다 실제 길이 30% 정도 길다고 봄
export const DELAY_MIN = { mid: 2, high: 5, peak: 10, closed: 15 };

export const walkMinutes = (straightM) => Math.round((straightM * DETOUR) / WALK_M_PER_MIN);

// routes: /api/transit 결과, levels: 구역별 혼잡도, activeClosureIds: 지금 통제 중인 id
export function rankTransit(routes, levels, activeClosureIds = []) {
  return routes
    .map((r, index) => {
      const walkMin = walkMinutes(r.walkStartM) + walkMinutes(r.walkEndM);
      const total = Math.max(r.minutes, r.stepMinutes + walkMin);
      const risks = r.passes
        .map((id) => {
          if (activeClosureIds.includes(id)) return { id, level: 'closed', delay: DELAY_MIN.closed };
          const lv = levels[id]?.level.key;
          return lv && DELAY_MIN[lv] ? { id, level: lv, delay: DELAY_MIN[lv] } : null;
        })
        .filter(Boolean);
      const delay = risks.reduce((a, x) => a + x.delay, 0);
      return { ...r, index, walkMin, total, risks, delay, score: total + delay };
    })
    .sort((a, b) => a.score - b.score || a.transfers - b.transfers);
}
