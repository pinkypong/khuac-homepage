export default function MembersLoading() {
  return (
    <main className="mx-auto max-w-2xl animate-pulse px-4 py-10">
      <div className="h-4 w-16 rounded bg-neutral-200" />
      <div className="mt-4 h-6 w-24 rounded bg-neutral-200" />
      <div className="mt-4 rounded-lg border border-neutral-200">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="border-b border-neutral-100 px-4 py-3 last:border-b-0">
            <div className="h-4 w-32 rounded bg-neutral-100" />
          </div>
        ))}
      </div>
    </main>
  );
}
