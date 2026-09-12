// Shaped like the real shell rather than a spinner: the header and the two
// panes land in the same places, so when the data arrives the page fills in
// instead of jumping.
export default function MapLoading() {
  return (
    <div className="flex h-app w-full animate-pulse flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <div className="h-4 w-20 rounded bg-neutral-200" />
        <div className="flex gap-3">
          <div className="h-3 w-10 rounded bg-neutral-200" />
          <div className="h-3 w-10 rounded bg-neutral-200" />
        </div>
      </div>

      <div className="flex min-h-0 w-full flex-1">
        <div className="hidden flex-1 bg-neutral-100 md:block" />
        <div className="hidden w-1.5 bg-neutral-200 md:block" />
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
          <div className="h-9 w-full rounded-lg bg-neutral-200" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 w-full rounded-lg bg-neutral-100" />
          ))}
        </div>
      </div>
    </div>
  );
}
