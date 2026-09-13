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
export type Timeframe = "today" | "tomorrow" | "this_weekend" | "next_week" | "unspecified";

export function resolveTimeframe(timeframe: Timeframe, now: Date = new Date()): DateRange {
  // getDay() reads the system clock's local time; Workers run in UTC, so this
  // is only correct because the forecast itself is later filtered by its own
  // Asia/Seoul-labelled dates, not by comparing Date objects across zones.
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

  const today = startOfDay(now);
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
      return { from: saturday, to: addDays(saturday, dayOfWeek === 0 ? 0 : 1) };
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
