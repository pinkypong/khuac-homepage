import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AuthButtons } from "@/components/auth-buttons";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = (await supabase.rpc("check_invite", { p_token: token }).single()) as {
    data: { valid: boolean; label: string | null } | null;
  };

  if (!data?.valid) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold">유효하지 않은 초대 링크입니다</h1>
        <p className="text-sm text-neutral-600">
          만료되었거나 이미 사용된 링크일 수 있습니다.
        </p>
        <Link href="/login" className="text-sm underline">
          일반 로그인으로 이동
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold">산악부에 초대되었습니다</h1>
        {data.label && <p className="mt-1 text-sm text-neutral-500">{data.label}</p>}
      </div>
      <AuthButtons inviteToken={token} />
    </main>
  );
}
