import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="flex gap-4 border-b border-neutral-200 px-4 py-3 text-sm">
        <Link href="/admin/members" className="hover:underline">
          가입 승인
        </Link>
        <Link href="/admin/invites" className="hover:underline">
          초대 링크
        </Link>
      </nav>
      {children}
    </div>
  );
}
