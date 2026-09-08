import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./upload-form";

export default async function UploadPhotosPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("hikes")
    .select("id, title, date")
    .order("date", { ascending: false });
  const hikes = (data ?? []) as { id: string; title: string; date: string }[];

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-6 text-xl font-semibold">사진 업로드</h1>
      <UploadForm hikes={hikes} />
    </main>
  );
}
