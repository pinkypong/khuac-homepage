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
  if (isRouteQuestion(query) || containsAny(query, JUDGMENT_WORDS)) return "complex";
  if (containsAny(query, WEATHER_WORDS)) return "weather";
  if (containsAny(query, LOCATION_WORDS)) return "location";
  // An unrecognised shape is exactly where a wrong guess would hurt most, so
  // it goes to the model that can actually read it.
  return "complex";
}

const ROUTE_WORDS = ["루트", "코스", "능선", "등산로", "등산길", "산행길", "경로"];

/**
 * A complex question that is specifically asking for named routes, as opposed
 * to a comparison or a general "괜찮을까" - this decides whether to spend the
 * extra grounded search call on real, current course names or answer with a
 * plain narrative instead.
 */
export function isRouteQuestion(query: string): boolean {
  return containsAny(query, ROUTE_WORDS) || (containsAny(query, ["등산", "산행"]) && containsAny(query, ["추천", "초보", "시간", "갈 만", "갈만"]));
}

// Everything a weather question is built from apart from the place itself.
// Stripping these leaves the name to look up: "이번주 청계산 날씨" -> "청계산".
//
// Sorted longest-first, which is load-bearing: "이번 주" is a prefix of
// "이번 주말", and removing the shorter one first left "말" stranded in front
// of the mountain.
//
// Single-character particles are deliberately absent. Removing "가" anywhere
// turns 가리산 into 리산, so they are trimmed from the end of the result
// instead, where they can only be particles.
const WEATHER_FILLER = [
  ...WEATHER_WORDS,
  "이번 주말", "이번주말", "다음 주말", "다음주말",
  "이번주", "이번 주", "이번", "금주", "다음주", "다음 주", "담주",
  "오늘", "내일", "모레", "당일", "주말", "토요일", "일요일", "토욜", "일욜",
  "알려줘", "알려", "어때", "어떤가", "확인", "좀",
].sort((a, b) => b.length - a.length);

const TRAILING_PARTICLE = /(의|은|는|이|가|에서|에)$/;

/**
 * The place a weather question is about, or null when it names none.
 *
 * Subtraction rather than extraction: there is no list of Korean mountains to
 * match against, but there is a short, closed list of the words a weather
 * question is otherwise made of. Whatever survives is the name - which is
 * then looked up, so a wrong guess fails visibly at the lookup rather than
 * silently answering about somewhere else.
 */
export function weatherSubject(query: string): string | null {
  let rest = query;
  for (const word of WEATHER_FILLER) rest = rest.split(word).join(" ");
  const subject = rest.replace(/\s+/g, " ").trim().replace(TRAILING_PARTICLE, "");
  // One stray character is noise, not a place name.
  return subject.length >= 2 ? subject : null;
}

export type TimeframeWord = "today" | "tomorrow" | "this_weekend" | "this_week" | "next_week" | "unspecified";

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
  if (containsAny(query, ["이번주", "이번 주", "금주"])) return "this_week";
  return "unspecified";
}
