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
  onCreateAlbum: (route: RouteSuggestion, asked: string) => void;
  activeRouteName: string | null;
  creatingAlbum: boolean;
}) {
  return (
    <div
      // The map's dedicated AI pane owns its scroll area. A fixed vh cap
      // left empty space below it and hid the example question on laptops.
      className="club-ai-card"
    >
      <div className="club-ai-heading">
        <span aria-hidden="true" className="club-ai-symbol">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="12" cy="12" r="9" />
            <path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z" />
          </svg>
        </span>
        <div><strong>KHUAC AI</strong><p>날씨 · 어프로치 · 코스</p></div>
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
