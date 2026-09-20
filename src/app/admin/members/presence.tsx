/** A member counts as here if their tab said so within this. */
const ONLINE_MS = 150_000;

/**
 * How long ago, in words, with a dot for "right now".
 *
 * The heartbeat runs once a minute, so the window is two and a half - one
 * missed beat on a slow connection should not read as having left. Anything
 * older is stated as a time rather than a colour: a member who was here twenty
 * minutes ago is not "away", they are simply not here, and three shades of
 * green would be inventing a distinction the data cannot support.
 *
 * Rendered on the server from the row's timestamp, so every admin sees the
 * same thing and there is no clock to disagree about across a hydration.
 */
export function Presence({ lastSeen, now }: { lastSeen: string | null; now: number }) {
  if (!lastSeen) {
    return <span className="text-xs text-club-faint">접속 기록 없음</span>;
  }
  const at = Date.parse(lastSeen);
  if (!Number.isFinite(at)) {
    return <span className="text-xs text-club-faint">접속 기록 없음</span>;
  }

  const elapsed = now - at;
  if (elapsed < ONLINE_MS) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-green-700">
        <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" aria-hidden="true" />
        접속 중
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-club-muted">
      <span className="h-2 w-2 shrink-0 rounded-full bg-club-line" aria-hidden="true" />
      {describe(elapsed, at)}
    </span>
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function describe(elapsed: number, at: number): string {
  if (elapsed < HOUR) return `${Math.max(1, Math.floor(elapsed / MINUTE))}분 전`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}시간 전`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}일 전`;
  return new Date(at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}
