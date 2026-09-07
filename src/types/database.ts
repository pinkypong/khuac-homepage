// Hand-written to match supabase/migrations/*.sql. No Docker in this dev
// environment to run `supabase gen types typescript --local` (see README) -
// replace this file with the generated one once that's available, and keep
// the two in sync until then.

export type MemberRole = "admin" | "member" | "pending";

export type PhotoLocationMatchStatus =
  | "auto_matched"
  | "manual_pending"
  | "manual_matched"
  | "no_gps";

export interface Member {
  id: string;
  auth_user_id: string;
  name: string;
  email: string | null;
  role: MemberRole;
  avatar_url: string | null;
  joined_at: string;
  updated_at: string;
}
