const UPDATED_AT = "2026-09-09";

export const metadata = {
  title: "개인정보처리방침",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="text-2xl font-semibold">개인정보처리방침</h1>
      <p className="mt-2 text-sm text-neutral-500">시행일 {UPDATED_AT}</p>

      <p className="mt-6 text-sm leading-relaxed text-neutral-700">
        본 사이트는 동아리 회원의 산행 기록과 사진을 공유하기 위한 비공개 커뮤니티입니다.
        가입 승인을 받은 회원만 이용할 수 있으며, 아래와 같이 개인정보를 처리합니다.
      </p>

      <Section title="1. 수집하는 개인정보 항목">
        <ul className="list-disc space-y-1 pl-5">
          <li>계정 정보: 이메일 주소, 이름, 프로필 사진 (Google 로그인 시 Google 계정에서 제공받음)</li>
          <li>이용 기록: 업로드한 사진, 사진에 포함된 촬영 일시 및 GPS 좌표(EXIF), 작성한 코멘트와 코스 정보</li>
        </ul>
      </Section>

      <Section title="2. 수집 방법">
        <p>회원가입(Google 로그인 또는 이메일 인증) 및 사진 업로드 과정에서 수집합니다.</p>
      </Section>

      <Section title="3. 처리 목적">
        <ul className="list-disc space-y-1 pl-5">
          <li>회원 식별 및 가입 승인 관리</li>
          <li>산행 기록·사진 아카이브 제공</li>
          <li>사진의 EXIF GPS 좌표를 이용한 산행 장소 자동 분류</li>
        </ul>
      </Section>

      <Section title="4. 보유 및 이용 기간">
        <p>
          회원 탈퇴 시까지 보유하며, 탈퇴 요청 시 계정 정보는 지체 없이 파기합니다. 다만 이미
          업로드된 사진은 동아리의 공동 기록물 성격을 가지므로, 삭제를 원하시는 경우 아래 연락처로
          요청해 주시면 개별 처리합니다.
        </p>
      </Section>

      <Section title="5. 처리 위탁 및 국외 이전">
        <p className="mb-2">서비스 운영을 위해 다음 사업자의 인프라를 이용합니다.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Supabase Inc. — 계정 인증 및 데이터베이스 (미국)</li>
          <li>Cloudflare Inc. — 사진 저장 및 웹사이트 호스팅 (미국)</li>
          <li>Google LLC — 로그인 인증, 지도 표시 (미국)</li>
        </ul>
      </Section>

      <Section title="6. 정보주체의 권리">
        <p>
          회원은 언제든지 자신의 개인정보에 대한 열람·정정·삭제·처리정지를 요구할 수 있으며,
          아래 연락처로 요청하시면 지체 없이 조치합니다.
        </p>
      </Section>

      <Section title="7. 안전성 확보 조치">
        <ul className="list-disc space-y-1 pl-5">
          <li>관리자 승인을 받은 회원만 데이터에 접근할 수 있도록 데이터베이스 수준의 접근 제어(RLS) 적용</li>
          <li>모든 통신 구간 HTTPS 암호화</li>
        </ul>
      </Section>

      <Section title="8. 생체인식정보(얼굴) 처리 여부">
        <p>
          현재 본 사이트는 얼굴 인식 등 생체인식정보를 일절 수집·처리하지 않습니다. 향후 사진 내
          인물 검색 기능을 도입할 경우, 관련 법령에 따라 본 방침을 개정하고 회원으로부터 별도의
          명시적 동의를 받은 후에만 시행합니다.
        </p>
      </Section>

      <Section title="9. 개인정보 보호책임자">
        <p>
          문의: <a className="underline" href="mailto:eigoogy1209@gmail.com">eigoogy1209@gmail.com</a>
        </p>
      </Section>

      <Section title="10. 방침의 변경">
        <p>
          본 방침이 변경되는 경우 시행일과 변경 내용을 본 페이지를 통해 공지합니다.
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-neutral-700">{children}</div>
    </section>
  );
}
