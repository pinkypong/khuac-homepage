import { AssistantPanel } from "@/app/assistant/assistant-panel";
import type { RouteSuggestion } from "@/lib/assistant/routes";

/**
 * KHUAC AI embedded directly on the root screen, above the recent-albums
 * hero, instead of behind a link to /assistant - asking about a place and
 * checking it against the map next to this panel used to mean leaving this
 * screen entirely. A separate file rather than a change inside
 * recent-albums.tsx on purpose: that component is under active design work,
 * and this needed no part of its rendering to sit above it.
 */
export function KhuacAiCard({
  onPreviewRoute,
  onCreateAlbum,
  activeRouteName,
  creatingAlbum,
}: {
  onPreviewRoute: (
    route: RouteSuggestion,
    place: { name: string | null; center: { lat: number; lng: number } | null },
  ) => void;
  onCreateAlbum: (route: RouteSuggestion) => void;
  activeRouteName: string | null;
  creatingAlbum: boolean;
}) {
  return (
    <div
      // Margins match .recent-albums's own 24px/16px padding (globals.css) so
      // this lines up with the album list below it. Capped and scrolled on its
      // own because it sits above the tabs now: a long course answer would
      // otherwise push 최근/장소별 앨범 off the bottom of the panel entirely.
      className="mx-6 mt-[22px] max-h-[55vh] shrink-0 overflow-y-auto rounded-lg border border-neutral-300 bg-neutral-50 p-3 max-[767px]:mx-4 max-[767px]:mt-4"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <span aria-hidden="true" className="text-base">
          ⛰️
        </span>
        <span className="text-sm font-semibold text-neutral-900">KHUAC AI</span>
        <span className="text-xs text-neutral-500">날씨정보, 어프로치, 코스추천</span>
      </div>
      <AssistantPanel
        onPreviewRoute={onPreviewRoute}
        onCreateAlbum={onCreateAlbum}
        activeRouteName={activeRouteName}
        creatingAlbum={creatingAlbum}
      />
    </div>
  );
}
