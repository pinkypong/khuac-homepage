import Link from "next/link";

/**
 * The front door to /assistant, placed above the recent-albums hero on the
 * root screen - the one place every member passes through, whether they came
 * to browse photos or to ask something. A separate file rather than a change
 * inside recent-albums.tsx on purpose: that component is under active design
 * work, and this needed no part of its rendering to sit above it.
 */
export function KhuacAiCard() {
  return (
    <Link
      href="/assistant"
      // Margins match .recent-albums's own 22px/24px padding (globals.css) so
      // this sits flush with the card below it rather than the wrapper's own
      // (padding-less) scroll container edge.
      className="mx-6 mt-[22px] flex items-center gap-3 rounded-lg border border-neutral-300 bg-neutral-900 px-3 py-2.5 text-white hover:bg-neutral-800 max-[767px]:mx-4 max-[767px]:mt-5"
    >
      <span aria-hidden="true" className="text-lg">
        ⛰️
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">KHUAC AI</span>
        <span className="block text-xs text-neutral-300">
          위치·날씨는 바로, 코스 추천은 AI에게 물어보세요
        </span>
      </span>
      <span aria-hidden="true" className="text-neutral-400">
        →
      </span>
    </Link>
  );
}
