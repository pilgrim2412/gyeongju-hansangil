// GET /api/config
// 화면이 쓸 공개 설정을 알려줘요.
// 카카오 JavaScript 키는 원래 웹페이지에 들어가는 공개 키라 보내도 괜찮아요.
// (카카오 개발자 콘솔에 등록한 사이트 주소에서만 작동해요.)
// 나머지 키는 "있는지 없는지"만 알려주고 값은 절대 보내지 않아요.

export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=300');
  res.status(200).json({
    kakaoJsKey: process.env.KAKAO_JS_KEY || '',
    hasRouteKey: Boolean(process.env.GRAPHHOPPER_API_KEY),
    hasForecastKey: Boolean(process.env.DATA_GO_KR_SERVICE_KEY),
  });
}
