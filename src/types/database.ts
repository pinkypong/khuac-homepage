// Hand-written to match supabase/migrations/*.sql. No Docker in this dev
// environment to run `supabase gen types typescript --local` (see README) -
// replace this file with the generated one once that's available, and keep
// the two in sync until then.

export type MemberRole = "admin" | "member" | "pending";

export type LocationType = "mountain" | "climbing_gym" | "crag";

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
  invited_via: string | null;
  joined_at: string;
  updated_at: string;
}

export interface Invite {
  id: string;
  token: string;
  label: string | null;
  created_by: string | null;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
