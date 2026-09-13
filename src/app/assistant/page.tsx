import Link from "next/link";
import { AssistantPanel } from "./assistant-panel";

export default function AssistantPage() {
  return (
    <main className="mx-auto flex min-h-app max-w-lg flex-col gap-4 px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(2rem+env(safe-area-inset-top))]">
      <Link href="/map" className="text-sm text-neutral-500 underline">
        ← 지도로
      </Link>
      <div>
        <h1 className="text-xl font-semibold">산행 도우미</h1>
        <p className="mt-1 text-sm text-neutral-500">
          위치나 날씨는 바로 답하고, 추천이나 판단이 필요한 질문만 AI에게 물어봅니다.
        </p>
      </div>
      <AssistantPanel />
    </main>
  );
}
