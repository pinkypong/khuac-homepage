"use client";

import { useEffect, useState, type FormEvent } from "react";
import { askAssistant, finishRouteAnswer, forgetQuestion, recentQuestions, type AssistantAnswer, type RecentQuestion } from "./actions";
import { parseMarkdown, type InlineToken } from "@/lib/assistant/markdown";
import type { RouteSuggestion } from "@/lib/assistant/routes";

// A place name is part of the question, not decoration: the weather path
// looks the place up in our own records, so "이번주 날씨" alone would resolve
// to nowhere and answer 장소를 찾지 못했습니다.
const EXAMPLES = ["이번 주말 북한산 날씨"];

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((token, i) =>
        token.bold ? (
          <strong key={i} className="font-semibold text-neutral-900">
            {token.text}
          </strong>
        ) : (
          <span key={i}>{token.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The model's Markdown, rendered as weight and size rather than as the
 * punctuation it arrived in - `**` and `#` used to reach the screen verbatim.
 */
function RichText({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return (
            <h3 key={i} className="mt-1 text-[15px] font-bold leading-snug text-neutral-900">
              <Inline tokens={block.content} />
            </h3>
          );
        }
        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              start={block.ordered ? block.start : undefined}
              key={i}
              className={
                "flex flex-col gap-1 pl-4 text-[13px] leading-relaxed text-neutral-700 " +
                (block.ordered ? "list-decimal" : "list-disc")
              }
            >
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inline tokens={item} />
                </li>
              ))}
            </ListTag>
          );
        }
        if (block.kind === "rule") {
          return <hr key={i} className="border-neutral-200" />;
        }
        if (block.kind === "table") {
          // The panel is narrow, so a wide comparison table scrolls sideways
          // in its own box rather than forcing the whole answer to.
          return (
            <div key={i} className="-mx-1 overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    {block.header.map((cell, j) => (
                      <th
                        key={j}
                        className="whitespace-nowrap border-b border-neutral-300 px-1.5 py-1 text-left font-semibold text-neutral-900"
                      >
                        <Inline tokens={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((cell, k) => (
                        <td
                          key={k}
                          className="border-b border-neutral-100 px-1.5 py-1 align-top text-neutral-700"
                        >
                          <Inline tokens={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={i} className="text-[13px] leading-relaxed text-neutral-700">
            <Inline tokens={block.content} />
          </p>
        );
      })}
    </div>
  );
}


export function AssistantPanel({
  onPreviewRoute,
  onCreateAlbum,
  activeRouteName,
  creatingAlbum,
}: {
  /** Draws the course on the site's own map. Absent on the standalone
      /assistant page, where there is no map beside the panel - the cards then
      render as plain boxes rather than as buttons that would do nothing. */
  onPreviewRoute?: (
    route: RouteSuggestion,
    place: { name: string | null; center: { lat: number; lng: number } | null },
  ) => void;
  onCreateAlbum?: (route: RouteSuggestion, asked: string) => void;
  activeRouteName?: string | null;
  creatingAlbum?: boolean;
} = {}) {
  const [question, setQuestion] = useState("");
  // The question this answer came from, kept apart from the box - the box is
  // the next question, and by the time somebody makes an album from a course
  // they may well have started typing one.
  const [asked, setAsked] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [recent, setRecent] = useState<RecentQuestion[]>([]);
  /** The second half is still coming: the answer is readable, the cards are not. */
  const [filling, setFilling] = useState(false);
  /**
   * What the panel is doing while it waits.
   *
   * The library answers in a few seconds and a web search takes half a minute,
   * so the wait itself says which one is running: past five seconds, nothing
   * else is slow enough to be the cause.
   */
  const [searching, setSearching] = useState(false);

  // What the club has already paid for. Asking one of these again is free, so
  // they are offered ahead of the examples.
  useEffect(() => {
    let cancelled = false;
    recentQuestions()
      .then((rows) => !cancelled && setRecent(rows))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [answer]);

  async function ask(text: string, refresh = false) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    setAnswer(null);
    setAsked(trimmed);
    setSearching(false);
    const slow = setTimeout(() => setSearching(true), 5000);
    try {
      const first = await askAssistant(trimmed, refresh);
      // A failure comes back as a value rather than as a throw, because a
      // production build replaces a thrown message with a generic one.
      if (first.failure) {
        setError(first.failure);
        return;
      }
      setAnswer(first);
      // The search answer is readable now; the cards are a second model call
      // and arrive on top of it. Waiting for both before showing anything is
      // what made a thirty-second answer feel like a broken one.
      if (first.routesPending) {
        setPending(false);
        setFilling(true);
        try {
          const whole = await finishRouteAnswer(trimmed);
          if (whole) setAnswer(whole);
        } catch {
          // The prose is already on screen and says what the cards would.
        } finally {
          setFilling(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "답을 가져오지 못했습니다.");
    } finally {
      clearTimeout(slow);
      setSearching(false);
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  const hasRoutes = (answer?.routes?.length ?? 0) > 0;
  // Cards carry their own citations now, so the row below the answer is only
  // for the leftovers - and a long tail of them is noise, not evidence.
  const citedUrls = new Set((answer?.routes ?? []).flatMap((route) => route.sourceUrls.map((s) => s.url)));
  const otherSources = (answer?.sources ?? []).filter((source) => !citedUrls.has(source.url)).slice(0, 3);
  const place = {
    name: answer?.routePlaceName ?? null,
    center: answer?.place ? { lat: answer.place.lat, lng: answer.place.lng } : null,
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <input
          maxLength={2000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="예: 관악산 등산 코스"
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base md:text-sm"
        />
        <button
          type="submit"
          disabled={pending || !question.trim()}
          className="rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {!pending ? "물어보기" : searching ? "저장된 코스에 없어 웹에서 찾는 중…" : "저장된 코스를 확인하는 중…"}
        </button>
      </form>

      {recent.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-medium text-neutral-400">최근 검색 · 다시 보기는 무료</p>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((item) => (
              // The question and its dismissal are two buttons rather than one
              // with a corner that does something else: a chip you tap to ask
              // again should not be able to delete the answer by a few pixels.
              <span
                key={item.question}
                className="flex max-w-full items-center rounded-full border border-[#e0cdd1] bg-[#faf5f6] text-xs text-[#5b1a23]"
              >
                <button
                  type="button"
                  onClick={() => {
                    setQuestion(item.question);
                    void ask(item.question);
                  }}
                  disabled={pending}
                  className="min-w-0 truncate py-1 pl-2.5 pr-1 disabled:opacity-50"
                >
                  {item.question}
                  <span className="ml-1 text-[10px] text-neutral-400">{item.ageLabel}</span>
                </button>
                <button
                  type="button"
                  aria-label={`'${item.question}' 검색 기록 지우기`}
                  onClick={() => {
                    // Off the list at once. The answer it held is gone either
                    // way, and waiting on the round trip to admit that only
                    // makes the tap feel broken.
                    setRecent((current) => current.filter((row) => row.question !== item.question));
                    void forgetQuestion(item.question).catch(() => {
                      void recentQuestions().then(setRecent).catch(() => {});
                    });
                  }}
                  className="shrink-0 px-2 py-1 text-neutral-400 hover:text-[#5b1a23]"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setQuestion(example)}
            className="rounded-full border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:bg-white"
          >
            {example}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {answer && (
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
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
          {answer.cachedAge && (
            <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-neutral-400">
              {answer.cachedAge} 검색 결과
              <button
                type="button"
                onClick={() => void ask(question || answer.text, true)}
                disabled={pending}
                className="underline disabled:opacity-50"
              >
                새로 검색
              </button>
            </span>
          )}

          {/* Every answer reads the same way down the panel: what is shut, then
              what applies to the whole outing, then the courses.

              Closures lead because they are the one thing that can send
              somebody to a gate that is closed, and the one part of an answer
              that is searched fresh every day rather than remembered. */}
          {answer.closures && (
            <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">오늘 통제 정보</p>
              <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-amber-900">
                {answer.closures}
              </p>
            </div>
          )}

          {/* The prose and the cards used to say the same thing one after the
              other. When courses were extracted, the cards are the answer:
              each carries its own description, and only a caveat that covers
              the whole outing stays outside them. */}
          {hasRoutes ? (
            answer.summary && (
              <p className="mt-2 text-[13px] leading-relaxed text-neutral-700">{answer.summary}</p>
            )
          ) : (
            <div className="mt-2">
              <RichText source={answer.text} />
            </div>
          )}

          {otherSources.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {hasRoutes && <span className="text-[10px] text-neutral-400">그 밖의 출처</span>}
              {otherSources.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-neutral-500 underline underline-offset-2 hover:text-neutral-700"
                >
                  {source.label}
                </a>
              ))}
            </div>
          )}

          {/* Said plainly, because the answer above is complete prose and a
              reader has no other way to know more is coming. */}
          {filling && (
            <p className="mt-3 border-t border-neutral-100 pt-3 text-[11px] text-neutral-500" role="status">
              코스를 지도에 올릴 수 있게 정리하는 중…
            </p>
          )}



          {answer.routes && answer.routes.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2 border-t border-neutral-100 pt-3">
              {answer.routes.map((route, i) => {
                const active = activeRouteName === route.name;
                const meta = [route.distanceText, route.durationText, route.difficulty]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li
                    key={i}
                    className={
                      "rounded-lg border transition-colors " +
                      (active ? "border-[#5b1a23] bg-[#faf5f6]" : "border-neutral-200")
                    }
                  >
                    <button
                      type="button"
                      onClick={() => onPreviewRoute?.(route, place)}
                      disabled={!onPreviewRoute}
                      className="w-full p-2.5 text-left disabled:cursor-default"
                    >
                      <span className="flex items-baseline gap-1.5">
                        <span className="min-w-0 flex-1 text-[13px] font-bold text-neutral-900">
                          {route.name}
                        </span>
                        {onPreviewRoute && (
                          <span className="shrink-0 text-[10px] font-medium text-[#5b1a23]">
                            {active ? "지도에 표시됨" : "지도에서 보기 →"}
                          </span>
                        )}
                      </span>
                      {route.waypoints.length > 0 && (
                        <span className="mt-1 block text-[12px] leading-relaxed text-neutral-700">
                          {route.waypoints.join(" → ")}
                        </span>
                      )}
                      {meta && (
                        <span className="mt-1 block text-[11px] font-medium text-neutral-600">{meta}</span>
                      )}
                      {route.description && (
                        <span className="mt-1.5 block text-[12px] leading-relaxed text-neutral-700">
                          {route.description}
                        </span>
                      )}
                      {route.notes && (
                        <span className="mt-1 block text-[11px] leading-relaxed text-neutral-500">
                          {route.notes}
                        </span>
                      )}
                    </button>

                    {route.sourceUrls.length > 0 && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 pb-2">
                        {route.sourceUrls.slice(0, 2).map((source) => (
                          <a
                            key={source.url}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-neutral-400 underline underline-offset-2 hover:text-neutral-600"
                          >
                            {source.label}
                          </a>
                        ))}
                      </div>
                    )}

                    {active && onCreateAlbum && (
                      <div className="border-t border-[#e8d9dc] px-2.5 py-2">
                        <button
                          type="button"
                          onClick={() => onCreateAlbum(route, asked)}
                          disabled={creatingAlbum}
                          className="rounded bg-[#5b1a23] px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
                        >
                          {creatingAlbum ? "만드는 중…" : "이 코스로 앨범 만들기"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
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
