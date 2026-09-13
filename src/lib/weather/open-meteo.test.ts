import { describe, expect, it } from "vitest";
import {
  daysInRange,
  parseForecastResponse,
  resolveTimeframe,
  summarizeForecast,
} from "./open-meteo";

function sampleResponse() {
  return {
    latitude: 37.66,
    longitude: 126.98,
    timezone: "Asia/Seoul",
    daily: {
      time: ["2026-09-14", "2026-09-15", "2026-09-16"],
      weather_code: [0, 61, 3],
      temperature_2m_max: [24.1, 19.5, 21.0],
      temperature_2m_min: [14.2, 15.1, 13.0],
      precipitation_probability_max: [5, 80, 20],
      precipitation_sum: [0, 12.4, 0.2],
      wind_speed_10m_max: [8.2, 22.5, 11.0],
    },
  };
}

describe("parseForecastResponse", () => {
  it("turns the flat daily arrays into one row per day", () => {
    const forecast = parseForecastResponse(sampleResponse());
    expect(forecast.days).toHaveLength(3);
    expect(forecast.days[0]).toMatchObject({
      date: "2026-09-14",
      weatherLabel: "맑음",
      tempMinC: 14.2,
      tempMaxC: 24.1,
    });
    expect(forecast.days[1].weatherLabel).toBe("비(약)");
  });

  it("falls back to a label rather than throwing for an unknown code", () => {
    const raw = sampleResponse();
    raw.daily.weather_code[0] = 9999;
    const forecast = parseForecastResponse(raw);
    expect(forecast.days[0].weatherLabel).toBe("정보 없음");
  });

  it("rejects a payload that is not shaped like a forecast", () => {
    expect(() => parseForecastResponse(null)).toThrow();
    expect(() => parseForecastResponse({})).toThrow();
    expect(() => parseForecastResponse({ daily: {} })).toThrow();
  });
});

describe("resolveTimeframe", () => {
  // A fixed Wednesday, so "this weekend" is unambiguous.
  const wednesday = new Date("2026-09-16T03:00:00Z");

  it("resolves today and tomorrow relative to now", () => {
    expect(resolveTimeframe("today", wednesday).from.toISOString().slice(0, 10)).toBe(
      "2026-09-16",
    );
    expect(resolveTimeframe("tomorrow", wednesday).from.toISOString().slice(0, 10)).toBe(
      "2026-09-17",
    );
  });

  it("resolves this_weekend to the coming Saturday and Sunday", () => {
    const { from, to } = resolveTimeframe("this_weekend", wednesday);
    expect(from.toISOString().slice(0, 10)).toBe("2026-09-19"); // Saturday
    expect(to.toISOString().slice(0, 10)).toBe("2026-09-20"); // Sunday
  });

  it("treats a Saturday as already being the weekend, not next week's", () => {
    const saturday = new Date("2026-09-19T03:00:00Z");
    const { from, to } = resolveTimeframe("this_weekend", saturday);
    expect(from.toISOString().slice(0, 10)).toBe("2026-09-19");
    expect(to.toISOString().slice(0, 10)).toBe("2026-09-20");
  });

  it("resolves next_week to the Monday after this one", () => {
    const { from } = resolveTimeframe("next_week", wednesday);
    expect(from.toISOString().slice(0, 10)).toBe("2026-09-21"); // Monday
  });

  it("resolves next_week correctly from a Monday and from a Sunday", () => {
    // From Monday itself, next week's Monday is a full 7 days out.
    const monday = new Date("2026-09-14T03:00:00Z");
    expect(resolveTimeframe("next_week", monday).from.toISOString().slice(0, 10)).toBe(
      "2026-09-21",
    );
    // Sunday is the last day of a Mon-Sun week, so next week starts tomorrow.
    const sunday = new Date("2026-09-20T03:00:00Z");
    expect(resolveTimeframe("next_week", sunday).from.toISOString().slice(0, 10)).toBe(
      "2026-09-21",
    );
  });
});

describe("daysInRange", () => {
  it("keeps only the days whose date falls in range", () => {
    const forecast = parseForecastResponse(sampleResponse());
    const filtered = daysInRange(forecast, {
      from: new Date("2026-09-15T00:00:00Z"),
      to: new Date("2026-09-15T00:00:00Z"),
    });
    expect(filtered.map((d) => d.date)).toEqual(["2026-09-15"]);
  });
});

describe("summarizeForecast", () => {
  it("produces one readable line per day", () => {
    const forecast = parseForecastResponse(sampleResponse());
    const summary = summarizeForecast(forecast.days.slice(0, 1));
    expect(summary).toContain("2026-09-14");
    expect(summary).toContain("맑음");
    expect(summary).toContain("강수확률 5%");
  });

  it("says so plainly when there is nothing to summarize", () => {
    expect(summarizeForecast([])).toBe("해당 기간의 예보 정보가 없습니다.");
  });
});
