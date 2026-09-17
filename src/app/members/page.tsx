import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { MemberRole } from "@/types/database";

interface RosterRow {
  id: string;
  name: string | null;
  role: MemberRole;
  joined_at: string;
}

function displayName(member: RosterRow) {
  return member.name?.trim() || "이름 없음";
}

function memberInitial(member: RosterRow) {
  const name = member.name?.trim();
  return name ? Array.from(name)[0] : "山";
}

function joinedLabel(joinedAt: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(joinedAt));
}

function MemberCard({ member, number }: { member: RosterRow; number: number }) {
  const isAdmin = member.role === "admin";

  return (
    <li className="member-card">
      <span className="member-index" aria-hidden="true">{String(number).padStart(2, "0")}</span>
      <span className={isAdmin ? "member-avatar member-avatar-admin" : "member-avatar"} aria-hidden="true">
        {memberInitial(member)}
      </span>
      <span className="member-card-copy">
        <span className="member-name-row">
          <strong>{displayName(member)}</strong>
          {isAdmin && <span className="member-role">운영진</span>}
        </span>
        <span className="member-joined">{joinedLabel(member.joined_at)} 가입</span>
      </span>
    </li>
  );
}

export default async function MembersPage() {
  const supabase = await createClient();

  // member_names, not members: the roster needs names and roles, and the
  // members table itself stays unreadable because it also holds email.
  const { data, error } = await supabase
    .from("member_names")
    .select("id, name, role, joined_at")
    .in("role", ["admin", "member"]);
  if (error) throw error;

  const members = ([...(data ?? [])] as RosterRow[]).sort((a, b) =>
    displayName(a).localeCompare(displayName(b), "ko"),
  );
  const admins = members.filter((member) => member.role === "admin");
  const regularMembers = members.filter((member) => member.role === "member");

  return (
    <main className="members-page min-h-app">
      <header className="members-header">
        <Link href="/map" className="members-brand" aria-label="KHUAC 지도로 돌아가기">
          <Image src="/khuac-logo-original.png" alt="경희대학교 산악부" width={282} height={262} priority />
          <span><strong>KHUAC</strong><small>경희대학교 산악부</small></span>
        </Link>
        <Link href="/map" className="members-back"><span aria-hidden="true">←</span> 지도</Link>
      </header>

      <div className="members-content">
        <section className="members-intro" aria-labelledby="members-title">
          <div>
            <p className="members-kicker">KHUAC MEMBERS</p>
            <h1 id="members-title">부원 명단</h1>
            <p className="members-description">현재 홈페이지 가입 승인이 완료된 부원입니다.</p>
          </div>
          <dl className="members-stats" aria-label="부원 현황">
            <div><dt>전체</dt><dd>{members.length}</dd></div>
            <div><dt>운영진</dt><dd>{admins.length}</dd></div>
          </dl>
        </section>

        {members.length === 0 ? (
          <section className="members-empty">
            <span aria-hidden="true">山</span>
            <p>아직 승인된 부원이 없습니다.</p>
          </section>
        ) : (
          <div className="members-roster">
            {admins.length > 0 && (
              <section className="member-group" aria-labelledby="admin-heading">
                <div className="member-section-title"><h2 id="admin-heading">운영진</h2><span>{admins.length}</span></div>
                <ul className="member-grid member-grid-admin">
                  {admins.map((member, index) => <MemberCard key={member.id} member={member} number={index + 1} />)}
                </ul>
              </section>
            )}

            {regularMembers.length > 0 && (
              <section className="member-group" aria-labelledby="member-heading">
                <div className="member-section-title"><h2 id="member-heading">부원</h2><span>{regularMembers.length}</span></div>
                <ul className="member-grid">
                  {regularMembers.map((member, index) => <MemberCard key={member.id} member={member} number={admins.length + index + 1} />)}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
