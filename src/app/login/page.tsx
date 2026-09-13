import Image from "next/image";
import { AuthButtons } from "@/components/auth-buttons";

export default function LoginPage() {
  return (
    <main className="login-shell min-h-app">
      <section className="login-photo" aria-label="경희대학교 산악부 활동 사진">
        <Image src="/login-climbing-bg.png" alt="북한산 암벽을 오르는 산악부원" fill priority sizes="(max-width: 767px) 100vw, 64vw" />
        <p>북한산 · 인수봉</p>
      </section>
      <section className="login-panel">
        <div className="login-panel-inner">
          <header className="login-brand">
            <Image src="/khuac-logo-original.png" alt="경희대학교 산악부" width={282} height={262} priority />
            <div><strong>KHUAC</strong><span>경희대학교 산악부</span></div>
          </header>
          <h1>로그인</h1>
          <div className="login-auth"><AuthButtons /></div>
        </div>
        <footer>KYUNGHEE UNIVERSITY ALPINE CLUB</footer>
      </section>
    </main>
  );
}
