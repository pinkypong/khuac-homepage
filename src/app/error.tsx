"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto flex min-h-app max-w-md flex-col justify-center gap-4 px-6">
    <h1 className="text-xl font-semibold">화면을 불러오지 못했습니다</h1>
    <p className="text-sm text-neutral-600">연결 상태를 확인하고 다시 시도해주세요. 문제가 계속되면 새로고침하거나 다시 로그인해주세요.</p>
    <button onClick={reset} className="rounded bg-[#5b1a23] px-4 py-3 text-white">다시 시도</button>
    <a href="/login" className="text-center text-sm underline">로그인 확인</a>
  </main>;
}
