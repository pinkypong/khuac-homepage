import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./upload-form";
import Link from "next/link";
import type { ActivityType } from "@/types/database";

export default async function UploadPhotosPage() {
  const supabase = await createClient();
  const [activities, places] = await Promise.all([
    supabase.from("hikes").select("id, title, date, activity_type, location_id").order("date", { ascending: false }),
    supabase.from("locations").select("id, name, region"),
  ]);
  if (activities.error) throw activities.error;
  if (places.error) throw places.error;
  const locations = new Map((places.data ?? []).map((p: {id:string;name:string;region:string|null}) => [p.id,p]));
  const hikes = (activities.data ?? []).map((h: {id:string;title:string;date:string;activity_type:ActivityType;location_id:string}) => ({...h, locationName:locations.get(h.location_id)?.name ?? "장소 미지정", region:locations.get(h.location_id)?.region ?? "지역 미지정"}));
  return <main className="mx-auto max-w-3xl px-5 py-8"><Link href="/map" className="text-sm text-neutral-500">← 지도 · 앨범</Link><h1 className="mb-7 mt-6 text-3xl font-bold tracking-tight">사진 업로드</h1><UploadForm hikes={hikes}/></main>;
}
