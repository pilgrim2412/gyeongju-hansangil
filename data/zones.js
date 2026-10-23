// 혼잡 구역 목록
// ─────────────────────────────────────────────────────────────
// 여기 값만 고치면 지도·시간표·경로 회피가 전부 같이 바뀌어요.
//
// short   : 시간표에 쓸 짧은 이름
// 모양은 둘 중 하나로 정해요.
//   polygon : [[위도, 경도], ...] 꼭짓점 목록 (실제 구역 모양)
//             사이트 주소 뒤에 ?draw 를 붙여 열면 지도를 찍어서 그리고 복사할 수 있어요.
//             예: https://gyeongju-hansangil.vercel.app/?draw
//   center + radiusM : 가운데 [위도, 경도] + 반경(미터)인 원
// season  : 계절 배율에 쓸 데이터 이름 (data/seasonality.js 참고)
// pattern : 평소 혼잡도 (1 = 낮음, 2 = 보통, 3 = 높음)
//           오전 06~11시 / 오후 12~17시 / 저녁 18~22시
//           ※ 지금 값은 임시예요. 경주 사람 감으로 고쳐 주세요!
// ─────────────────────────────────────────────────────────────

export const ZONES = [
  {
    id: 'hwangnidan',
    name: '황리단길',
    short: '황리단길',
    // ※ 대략 그린 임시 경계예요. ?draw 로 다시 그려 주세요.
    polygon: [
  [35.83939, 129.20986],
  [35.83895, 129.20727],
  [35.83376, 129.20737],
  [35.83363, 129.20940],
  [35.83306, 129.20943],
  [35.83317, 129.21118],
  [35.83451, 129.21117],
  [35.83441, 129.21276],
  [35.83518, 129.21260],
  [35.83538, 129.21257],
  [35.83557, 129.21253],
  [35.83570, 129.21255],
  [35.83589, 129.21268],
  [35.83644, 129.21209],
  [35.83644, 129.21209],
  [35.83733, 129.21112],
  [35.83851, 129.20984],
    ],
    season: '황리단길권역',
    pattern: {
      weekday: { morning: 1, afternoon: 2, evening: 2 },
      weekend: { morning: 2, afternoon: 3, evening: 3 },
    },
  },
  {
    id: 'daereungwon',
    name: '대릉원',
    short: '대릉원',
    // ※ 대략 그린 임시 경계예요. ?draw 로 다시 그려 주세요.
    polygon: [
  [35.83941, 129.20992],
  [35.83859, 129.20986],
  [35.83591, 129.21275],
  [35.83560, 129.21346],
  [35.83562, 129.21402],
  [35.83550, 129.21495],
  [35.83510, 129.21531],
  [35.83510, 129.21541],
  [35.83467, 129.21576],
  [35.83511, 129.21627],
  [35.83548, 129.21596],
  [35.83567, 129.21570],
  [35.83616, 129.21484],
  [35.83655, 129.21445],
  [35.83721, 129.21405],
  [35.83766, 129.21381],
  [35.83793, 129.21372],
  [35.83847, 129.21365],
  [35.84016, 129.21359],
  [35.84036, 129.21352],
    ],
    season: '대릉원',
    pattern: {
      weekday: { morning: 1, afternoon: 2, evening: 1 },
      weekend: { morning: 2, afternoon: 3, evening: 2 },
    },
  },
  {
    id: 'gyochon',
    name: '첨성대·교촌·월정교',
    short: '첨성대·교촌',
    center: [35.8318, 129.2172],
    radiusM: 420,
    season: '교촌한옥마을',
    pattern: {
      weekday: { morning: 1, afternoon: 2, evening: 1 },
      weekend: { morning: 2, afternoon: 3, evening: 2 },
    },
  },
  {
    id: 'donggung',
    name: '동궁과월지·박물관',
    short: '동궁과월지',
    center: [35.8325, 129.2270],
    radiusM: 360,
    season: '기본',
    pattern: {
      weekday: { morning: 1, afternoon: 1, evening: 2 },
      weekend: { morning: 1, afternoon: 2, evening: 3 },
    },
  },
  {
    id: 'bomun',
    name: '보문관광단지·경주월드',
    short: '보문·경주월드',
    center: [35.8410, 129.2845],
    radiusM: 1100,
    season: '기본',
    pattern: {
      weekday: { morning: 1, afternoon: 2, evening: 1 },
      weekend: { morning: 2, afternoon: 3, evening: 2 },
    },
  },
  {
    id: 'bulguksa',
    name: '불국사',
    short: '불국사',
    center: [35.7900, 129.3320],
    radiusM: 450,
    season: '기본',
    pattern: {
      weekday: { morning: 1, afternoon: 2, evening: 1 },
      weekend: { morning: 2, afternoon: 3, evening: 1 },
    },
  },
];
