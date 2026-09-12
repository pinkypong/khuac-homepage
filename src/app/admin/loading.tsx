// Sits inside the admin layout, so the nav above it is already painted and
// only the page body needs standing in for.
export default function AdminLoading() {
  return (
    <main className="mx-auto max-w-2xl animate-pulse px-4 py-8 md:py-10">
      <div className="mb-6 h-6 w-32 rounded bg-neutral-200" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="mb-3 h-20 w-full rounded border border-neutral-200 bg-neutral-50" />
      ))}
    </main>
  );
}
