import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: member } = user
    ? await supabase.from("members").select("name, role").eq("auth_user_id", user.id).single()
    : { data: null };

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">산악부 홈페이지</h1>
      {member && (
        <p className="text-neutral-600">
          {member.name}님, 환영합니다. ({member.role})
        </p>
      )}
      <p className="text-sm text-neutral-400">
        산행 지도, 사진 갤러리는 이후 Phase에서 추가됩니다.
      </p>
      <SignOutButton />
    </main>
  );
}
