/**
 * The count of members waiting to be approved.
 *
 * Orange rather than the app's red, which is spoken for: on the map red means
 * "the route you selected". This is a nudge, not an alarm.
 */
export function PendingBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span
      aria-label={`승인 대기 ${count}명`}
      className="inline-flex min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-orange-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
