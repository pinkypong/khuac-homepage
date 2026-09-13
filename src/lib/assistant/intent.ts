/**
 * Routes a question before any model is called.
 *
 * "인수봉 위치" and "인수봉 오늘 날씨" have exact answers sitting in our own DB
 * and a free weather API - asking an LLM to fetch and relay them adds cost,
 * latency and a chance of getting a number wrong for no benefit. Gemini is
 * worth its cost only once a question asks for judgment: a recommendation, a
 * comparison, "괜찮을까" rather than "몇 도야".
 *
 * This is a cost optimisation, not a correctness boundary, and it is built to
 * fail toward Gemini rather than away from it: a query this misses as
 * "complex" still gets a correct answer, just at Gemini's price. A query this
 * wrongly calls "simple" would return an incomplete answer with no chance to
 * recover, so every list below is kept narrow and a query touching both a
 * simple topic and a judgment word is routed as complex.
 */
export type QueryIntent = "location" | "weather" | "complex";

// Any of these turns a query complex regardless of what else it contains -
// recommending, comparing, or judging suitability needs synthesis, not a
// lookup. "위치랑 날씨 다 알려줘" asks for two lookups glued together, which
// this list does not catch on purpose: routing it as complex costs one extra
// call and still produces a correct combined answer.
const JUDGMENT_WORDS = [
  "추천",
  "루트",
  "코스",
  "초보",
  "초심자",
  "숙련",
  "난이도",
  "비교",
  "얼마나",
  "몇 시간",
  "갈만",
  "갈 만",
  "괜찮",
  "가도",
  "가볼",
  "가볼만",
  "도전",
  "준비물",
  "챙겨",
  "챙길",
  "계획",
  "어떤",
  "어디가",
  "vs",
];

const WEATHER_WORDS = ["날씨", "기온", "온도", "비 와", "비와", "눈 와", "눈와", "바람", "강수"];

const LOCATION_WORDS = ["위치", "어디", "좌표", "지도"];

function containsAny(query: string, words: string[]): boolean {
  return words.some((word) => query.includes(word));
}

export function classifyQuery(query: string): QueryIntent {
  if (containsAny(query, JUDGMENT_WORDS)) return "complex";
  if (containsAny(query, WEATHER_WORDS)) return "weather";
  if (containsAny(query, LOCATION_WORDS)) return "location";
  // An unrecognised shape is exactly where a wrong guess would hurt most, so
  // it goes to the model that can actually read it.
  return "complex";
}

const ROUTE_WORDS = ["루트", "코스", "능선"];

/**
 * A complex question that is specifically asking for named routes, as opposed
 * to a comparison or a general "괜찮을까" - this decides whether to spend the
 * extra grounded search call on real, current course names or answer with a
 * plain narrative instead.
 */
export function isRouteQuestion(query: string): boolean {
  return containsAny(query, ROUTE_WORDS);
}

export type TimeframeWord = "today" | "tomorrow" | "this_weekend" | "next_week" | "unspecified";

/**
 * A word match, not date arithmetic - resolveTimeframe in the weather module
 * turns the result into actual dates against the real clock. This only has to
 * recognise which word was used.
 */
export function extractTimeframe(query: string): TimeframeWord {
  if (containsAny(query, ["오늘", "당일"])) return "today";
  if (containsAny(query, ["내일"])) return "tomorrow";
  if (containsAny(query, ["주말", "토요일", "일요일", "토욜", "일욜"])) return "this_weekend";
  if (containsAny(query, ["다음주", "다음 주", "담주"])) return "next_week";
  return "unspecified";
}
