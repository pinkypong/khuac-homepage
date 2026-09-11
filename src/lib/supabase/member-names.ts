import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const UNKNOWN_MEMBER_NAME = "알 수 없음";

export interface MemberSummary {
  name: string;
  isAdmin: boolean;
}

/**
 * Resolves member ids to the name and role shown beside whatever they wrote.
 *
 * The members table itself stays readable only to its owner and to admins -
 * it holds email, and the publishable key is in the browser bundle. The view
 * exposes name and role alone, so it is queried separately rather than
 * embedded as a join: one extra round trip buys names that cannot leak an
 * address.
 */
export async function memberDirectory(
  supabase: Supabase,
  ids: (string | null | undefined)[],
): Promise<Map<string, MemberSummary>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from("member_names")
    .select("id, name, role")
    .in("id", unique);
  // A missing name is cosmetic; failing the whole page over it is not worth it.
  if (error) {
    console.error("[member-names] lookup failed:", error);
    return new Map();
  }

  return new Map(
    ((data ?? []) as { id: string; name: string | null; role: string }[])
      .filter((m) => m.name)
      .map((m) => [m.id, { name: m.name as string, isAdmin: m.role === "admin" }]),
  );
}
