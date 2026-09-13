/**
 * Open-Meteo, not a Google or paid API: no key, no billing, free for
 * non-commercial use, and a mountaineering club posting its own trip reports
 * is exactly that. https://open-meteo.com/en/pricing
 *
 * daily.weather_code follows WMO code 4677 - the same table used by most
 * weather services, kept here as a small lookup rather than pulled in as a
 * dependency.
 */
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

const TIMEOUT_MS = 8_000;

export interface DailyForecast {
  date: string; // YYYY-MM-DD, in the location's own timezone
  weatherCode: number;
  weatherLabel: string;
  tempMinC: number;
  tempMaxC: number;
  precipitationProbability: number; // percent, 0-100
  precipitationMm: number;
  windSpeedMaxKmh: number;
}

export interface LocationForecast {
  lat: number;
  lng: number;
  timezone: string;
  days: DailyForecast[];
}

const WEATHER_LABELS: Record<number, string> = {
  0: "맑음",
  1: "대체로 맑음",
  2: "구름 조금",
  3: "흐림",
  45: "안개",
  48: "짙은 안개(서리)",
  51: "이슬비(약)",
  53: "이슬비(보통)",
  55: "이슬비(강)",
  61: "비(약)",
  63: "비(보통)",
  65: "비(강)",
  66: "언 비(약)",
  67: "언 비(강)",
  71: "눈(약)",
  73: "눈(보통)",
  75: "눈(강)",
  77: "싸락눈",
  80: "소나기(약)",
  81: "소나기(보통)",
  82: "소나기(강)",
  85: "소낙눈(약)",
  86: "소낙눈(강)",
  95: "뇌우",
  96: "우박 동반 뇌우(약)",
  99: "우박 동반 뇌우(강)",
};

function weatherLabel(code: number): string {
  return WEATHER_LABELS[code] ?? "정보 없음";
}

/**
 * A week-ish forecast for one point, for both display and as text handed to
 * the assistant. Elevation is not passed to the API: hikes.lat/lng is the
 * trailhead or a point along the route, not the summit, and Open-Meteo already
 * adjusts to its own terrain model for that coordinate.
 */
export async function fetchForecast(lat: number, lng: number): Promise<LocationForecast> {
  const url = new URL(FORECAST_URL);
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lng.toFixed(4));
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "precipitation_sum",
      "wind_speed_10m_max",
    ].join(","),
  );
  url.searchParams.set("timezone", "Asia/Seoul");
  url.searchParams.set("forecast_days", "10");

  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`날씨 정보를 불러오지 못했습니다 (${response.status})`);
  }

  return parseForecastResponse(await response.json());
}

interface RawForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    precipitation_sum: number[];
    wind_speed_10m_max: number[];
  };
}

/** Split out from fetchForecast so the parsing logic can be unit-tested on a
    fixture without a network call. */
export function parseForecastResponse(payload: unknown): LocationForecast {
  const raw = payload as Partial<RawForecast> | null;
  const daily = raw?.daily;
  if (!raw || !daily || !Array.isArray(daily.time)) {
    throw new Error("날씨 응답 형식이 올바르지 않습니다.");
  }

  const days: DailyForecast[] = daily.time.map((date, i) => ({
    date,
    weatherCode: daily.weather_code[i],
    weatherLabel: weatherLabel(daily.weather_code[i]),
    tempMinC: daily.temperature_2m_min[i],
    tempMaxC: daily.temperature_2m_max[i],
    precipitationProbability: daily.precipitation_probability_max[i] ?? 0,
    precipitationMm: daily.precipitation_sum[i] ?? 0,
    windSpeedMaxKmh: daily.wind_speed_10m_max[i] ?? 0,
  }));

  return {
    lat: raw.latitude as number,
    lng: raw.longitude as number,
    timezone: raw.timezone as string,
    days,
  };
}

/**
 * Days matching a natural-language timeframe, resolved against the wall clock
 * rather than left to a language model - asking an LLM to compute "이번 주말"
 * is asking it to do date arithmetic it is not reliable at, when Date already
 * does this exactly.
 */
export type Timeframe = "today" | "tomorrow" | "this_weekend" | "this_week" | "next_week" | "unspecified";

export function resolveTimeframe(timeframe: Timeframe, now: Date = new Date()): DateRange {
  // All ranges use Korean calendar dates, independent of the server timezone.
  const startOfDay = (d: Date) => {
    const copy = new Date(d);
    copy.setUTCHours(0, 0, 0, 0);
    return copy;
  };
  const addDays = (d: Date, n: number) => {
    const copy = new Date(d);
    copy.setUTCDate(copy.getUTCDate() + n);
    return copy;
  };

  // Represent the Korean calendar date as UTC midnight for date-only comparisons.
  const today = startOfDay(new Date(now.getTime() + 9 * 60 * 60 * 1000));
  const dayOfWeek = today.getUTCDay(); // 0 = Sunday

  switch (timeframe) {
    case "today":
      return { from: today, to: today };
    case "tomorrow":
      return { from: addDays(today, 1), to: addDays(today, 1) };
    case "this_weekend": {
      // If today is already Sat/Sun, "this weekend" means the days remaining
      // in it, not next week's.
      const daysToSaturday = dayOfWeek === 6 ? 0 : dayOfWeek === 0 ? -1 : 6 - dayOfWeek;
      const saturday = addDays(today, daysToSaturday);
      return { from: dayOfWeek === 0 ? today : saturday, to: addDays(saturday, 1) };
    }
    case "this_week": {
      const monday = addDays(today, -((dayOfWeek + 6) % 7));
      return { from: monday, to: addDays(monday, 6) };
    }
    case "next_week": {
      // Days from today to *next* week's Monday (Mon-Sun weeks). Converting to
      // a Monday-indexed weekday first (0=Mon..6=Sun) is what makes the "+7"
      // land on next week rather than two weeks out.
      const mondayIndex = (dayOfWeek + 6) % 7;
      const daysToNextMonday = 7 - mondayIndex;
      return { from: addDays(today, daysToNextMonday), to: addDays(today, daysToNextMonday + 6) };
    }
    case "unspecified":
    default:
      return { from: today, to: addDays(today, 4) };
  }
}

export interface DateRange {
  from: Date;
  to: Date;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysInRange(forecast: LocationForecast, range: DateRange): DailyForecast[] {
  const from = toDateKey(range.from);
  const to = toDateKey(range.to);
  return forecast.days.filter((day) => day.date >= from && day.date <= to);
}

/** A short Korean paragraph, meant as context handed to the assistant model -
    not as the text shown to the member, who sees the numbers directly. */
export function summarizeForecast(days: DailyForecast[]): string {
  if (days.length === 0) return "해당 기간의 예보 정보가 없습니다.";
  return days
    .map(
      (d) =>
        `${d.date}: ${d.weatherLabel}, 기온 ${Math.round(d.tempMinC)}~${Math.round(d.tempMaxC)}도, ` +
        `강수확률 ${d.precipitationProbability}%, 강수량 ${d.precipitationMm}mm, ` +
        `최대풍속 ${Math.round(d.windSpeedMaxKmh)}km/h`,
    )
    .join("\n");
}

export interface GeocodedPlace {
  name: string;
  lat: number;
  lng: number;
  /** "경기도 과천시" - shown with the answer so a wrong match is visible
      rather than silently producing the weather for the wrong mountain. */
  region: string | null;
}

interface RawPlace {
  name?: string;
  latitude?: number;
  longitude?: number;
  feature_code?: string;
  admin1?: string;
  admin2?: string;
}

/**
 * Picks the place a member most likely meant.
 *
 * Names repeat across the country - 청계산 alone returns three mountains, in
 * 포천, 양평 and 과천 - and the list does not come back in any order that
 * corresponds to which one a Seoul climbing club means. Two rules sort it out:
 * prefer mountains over towns sharing the name, then take whichever is nearest
 * the places the club actually goes to.
 *
 * The bias point is the average of our own locations rather than a hardcoded
 * Seoul: if the club's centre of gravity moves, this follows it.
 */
export function chooseGeocodedPlace(
  payload: unknown,
  bias: { lat: number; lng: number } | null,
): GeocodedPlace | null {
  const results = (payload as { results?: RawPlace[] } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) return null;

  const usable = results.filter(
    (r): r is RawPlace & { latitude: number; longitude: number } =>
      typeof r.latitude === "number" && typeof r.longitude === "number",
  );
  if (usable.length === 0) return null;

  // "MT" is Open-Meteo's feature code for a mountain; anything else sharing
  // the name (a village, a bus stop) is not what a hiking question meant.
  const mountains = usable.filter((r) => r.feature_code?.startsWith("MT"));
  const candidates = mountains.length > 0 ? mountains : usable;

  const best = bias
    ? candidates.reduce((closest, candidate) => {
        const distance = (r: typeof candidate) =>
          (r.latitude - bias.lat) ** 2 + (r.longitude - bias.lng) ** 2;
        return distance(candidate) < distance(closest) ? candidate : closest;
      })
    : candidates[0];

  return {
    name: best.name ?? "",
    lat: best.latitude,
    lng: best.longitude,
    region: [best.admin1, best.admin2].filter(Boolean).join(" ") || null,
  };
}

/**
 * Finds a place the club has no record of, so the weather answer is not
 * limited to mountains someone already made a folder for.
 *
 * Free and keyless, like the forecast endpoint itself. Our own locations are
 * still checked first: this gazetteer knows mountains, not the club's crags -
 * 백운대 resolves to a 90m spot in 경주 rather than the 836m one on 북한산,
 * and 선인봉 is absent entirely, while both have exact coordinates in our
 * own rows because a member stood there and placed them.
 */
export async function geocodePlace(
  name: string,
  bias: { lat: number; lng: number } | null,
): Promise<GeocodedPlace | null> {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", name);
  url.searchParams.set("count", "10");
  url.searchParams.set("language", "ko");
  url.searchParams.set("country", "KR");

  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) return null;
  return chooseGeocodedPlace(await response.json(), bias);
}
