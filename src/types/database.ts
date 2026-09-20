// Hand-written to match supabase/migrations/*.sql. No Docker in this dev
// environment to run `supabase gen types typescript --local` (see README) -
// replace this file with the generated one once that's available, and keep
// the two in sync until then.

export type MemberRole = "admin" | "member" | "pending";

export type LocationType = "mountain" | "climbing_gym" | "crag" | "multi_pitch" | "hard_free";

export type ActivityType = "hiking" | "indoor_climbing" | "outdoor_wall" | "climbing";

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

export interface Comment {
  id: string;
  author_id: string | null;
  // Exactly one of these is set - see the comments_one_subject constraint.
  photo_id: string | null;
  hike_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}
