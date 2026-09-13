/** Scope for optional equipment advice across assistant answer paths. */
export const EQUIPMENT_GUIDANCE = "일반 산행이나 장소 추천 답변에는 준비물·장비 체크리스트를 자동으로 붙이지 마세요. 사용자가 준비물을 직접 묻거나 암벽등반 루트를 다루는 경우에만 장비를 안내합니다. 볼더링과 실외 리드 인공암벽은 구분해서 안내하세요.";

/**
 * Where a question is about when it does not say.
 *
 * The club is at Kyung Hee University in Seoul, so "근처", "가까운" and a bare
 * place name mean Seoul unless the member says otherwise. This exists because
 * the opposite instruction was tried first - asking which campus was meant -
 * and it turned "경희대 근처 볼더링장 추천" into a question back at the member
 * instead of an answer. Not knowing the exact campus is not a reason to
 * withhold a list of gyms in eastern Seoul.
 */
export const REGION_GUIDANCE = "지역이 명시되지 않으면 서울을 기준으로 답하세요. '근처'나 '가까운'도 서울 기준입니다. 경희대는 서울캠퍼스(동대문구 회기동)를 기본으로 삼고, 국제캠퍼스(용인시 기흥구)는 필요하면 짧게 덧붙이세요. 캠퍼스나 지역이 불분명하다는 이유로 되묻거나 답을 미루지 마세요. 어느 기준으로 답했는지는 맨 앞에 문단으로 설명하지 말고, 필요하면 제목 옆이나 끝에 짧은 괄호로만 밝히세요.";

/**
 * How an answer opens.
 *
 * The model was starting with a sentence explaining what it was about to do
 * ("지역이 명시되지 않아 서울 기준으로 안내합니다") before any content. A
 * member who typed a question already knows what they asked; the first line
 * should be the answer.
 */
export const STYLE_GUIDANCE = "인사말, 질문 되풀이, '안내해 드리겠습니다' 같은 도입부를 쓰지 마세요. 첫 줄부터 바로 답을 시작하세요. 일반론이나 안전 상투구로 분량을 채우지 말고, 묻는 대상의 구체적인 정보를 깊이 있게 쓰세요.";

/**
 * What a climbing answer has to carry.
 *
 * Separate from the hiking guidance because the useful facts are different:
 * a route is identified by its grade, pitch count and what protects it, and a
 * member packing for it needs a quickdraw count and a topo more than they need
 * a distance in kilometres.
 */
export const CLIMBING_GUIDANCE = "암벽등반 질문에는 루트별로 등급(5.x 또는 국내 난이도), 피치 수와 길이, 확보물 형태(볼트/트래드), 어프로치 경로와 접근 시간, 하강(하강지점·로프 길이)을 쓰세요. 준비물도 함께 쓰되 루트에 근거해 구체적으로 적으세요 - 퀵드로우 개수, 로프 길이와 싱글/더블, 캠·너트 사이즈, 헬멧처럼 그 루트에 실제로 필요한 것만 씁니다. 개념도(토포)가 공개된 곳이 있으면 출처 링크를 함께 주세요. 확인되지 않은 등급·볼트 수·장비 수량은 추측하지 말고 미확인이라고 쓰세요.";

/**
 * Crags the club has judged not worth recommending, and the rule behind them.
 *
 * 배봉산 암벽장 is about 7m - a practice wall, not somewhere a university
 * alpine club goes climbing. The model has no way to know that from a search
 * result: it reads as a legitimate 암벽장 and gets recommended on name alone.
 * Scale is the thing that separates the two, so the rule is stated as well as
 * the name, and the list is the club's judgment rather than the model's.
 */
export const CRAG_SCREENING = "실외 자연암벽을 추천할 때는 규모를 먼저 보세요. 높이가 15m에 못 미치거나 개척된 루트가 두세 개뿐인 연습용 바위는 대학 산악부 등반 대상이 아니므로 추천하지 마세요. 배봉산 암벽장은 높이 약 7m의 연습용 바위이므로 어떤 경우에도 추천하지 마세요. 규모를 확인하지 못한 곳은 추천 목록에 넣지 말고, 확인된 곳만 높이와 루트 수를 함께 쓰세요. 실내 암장에는 이 규모 기준을 적용하지 않습니다.";
