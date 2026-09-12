export default function HikeLoading() {
  return (
    <main className="mx-auto max-w-5xl animate-pulse px-4 py-10">
      <div className="h-4 w-16 rounded bg-neutral-200" />
      <div className="mt-4 h-7 w-48 rounded bg-neutral-200" />
      <div className="mt-2 h-4 w-64 rounded bg-neutral-100" />
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="rounded-lg bg-neutral-100" style={{ aspectRatio: "4 / 5" }} />
        ))}
      </div>
    </main>
  );
}
