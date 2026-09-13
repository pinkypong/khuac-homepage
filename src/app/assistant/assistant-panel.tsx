"use client";

import { useState, type FormEvent } from "react";
import { askAssistant, type AssistantAnswer } from "./actions";
import { RouteMap } from "./route-map";

const EXAMPLES = ["인수봉 위치", "이번 주말 북한산 날씨", "초보자에게 괜찮은 코스 추천해줘"];

function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function AssistantPanel() {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;

    setPending(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await askAssistant(trimmed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "답을 가져오지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="예: 인수봉 위치"
          className="rounded-lg border border-neutral-300 px-3 py-2 text-base md:text-sm"
        />
        <button
          type="submit"
          disabled={pending || !question.trim()}
          className="rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "확인하는 중…" : "물어보기"}
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setQuestion(example)}
            className="rounded-full border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
          >
            {example}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {answer && (
        <div className="rounded-lg border border-neutral-200 p-4">
          {/* The intent badge is a debugging window left visible on purpose for
              now: it shows at a glance whether a question stayed free (바로
              답변) or spent a Gemini call, while the club is still watching
              how the classifier behaves on real questions. */}
          <span className="inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
            {answer.intent === "location"
              ? "바로 답변 · 위치"
              : answer.intent === "weather"
                ? "바로 답변 · 날씨"
                : "AI 답변"}
          </span>

          <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">{answer.text}</p>

          {answer.place && (
            <a
              href={mapsLink(answer.place.lat, answer.place.lng)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs text-neutral-500 underline"
            >
              {answer.place.name} · Google 지도에서 보기
            </a>
          )}

          {answer.routes && answer.routes.length > 0 && answer.place && (
            <>
              <RouteMap routes={answer.routes} center={{ lat: answer.place.lat, lng: answer.place.lng }} />
              <ul className="mt-3 flex flex-col gap-2 border-t border-neutral-100 pt-3">
                {answer.routes.map((route, i) => (
                  <li key={i} className="rounded border border-neutral-200 p-2">
                    <p className="text-xs font-semibold">{route.name}</p>
                    <p className="mt-0.5 text-[11px] text-neutral-600">
                      {route.waypoints.join(" → ")}
                    </p>
                    {(route.distanceText || route.notes) && (
                      <p className="mt-0.5 text-[11px] text-neutral-500">
                        {[route.distanceText, route.notes].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {route.sourceUrls.length > 0 && (
                      <p className="mt-1 flex flex-wrap gap-2">
                        {route.sourceUrls.map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-neutral-400 underline"
                          >
                            출처
                          </a>
                        ))}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {answer.forecastDays && answer.forecastDays.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-neutral-100 pt-3">
              {answer.forecastDays.map((day) => (
                <li key={day.date} className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500">{day.date}</span>
                  <span className="text-neutral-700">{day.weatherLabel}</span>
                  <span className="tabular-nums text-neutral-700">
                    {Math.round(day.tempMinC)}~{Math.round(day.tempMaxC)}°
                  </span>
                  <span className="tabular-nums text-neutral-500">
                    강수 {day.precipitationProbability}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
