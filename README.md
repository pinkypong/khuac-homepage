# khuac-homepage

산악부 홈페이지. 산행 기록과 사진을 모아두고, 사진의 EXIF GPS로 산행 장소를 자동 매핑하는 것이 핵심입니다.

## 스택

| 영역 | 선택 |
| --- | --- |
| 프레임워크 | Next.js 15.5.25 (App Router, TypeScript, Tailwind CSS v4) |
| 호스팅 | Cloudflare Workers (`@opennextjs/cloudflare` 어댑터) |
| DB / Auth | Supabase (Postgres, RLS, pgvector) |
| 사진 저장소 | Cloudflare R2 (원본 + 변환 썸네일 캐시) |
| 이미지 리사이징 | Cloudflare Images 바인딩 (최초 1회 변환 후 R2에 캐시) |
| 지도 | Google Maps Platform |

> **네이티브 바이너리 금지**: Workers 런타임은 V8 isolate 기반이라 `sharp` 같은 네이티브 모듈을
> 실행할 수 없습니다. 썸네일/프리뷰는 `wrangler.jsonc`의 `IMAGES` 바인딩으로 요청 시점에
> 만들고, 결과를 R2에 캐시해 사진당 한 번만 변환합니다.

## 로컬 개발 시작하기

```bash
npm install
cp .env.local.example .env.local   # 값 채우기
npm run dev                        # http://localhost:3000
```

`.env.local`은 gitignore 대상입니다. 실제 키 값을 커밋하지 마세요.

### 두 가지 개발 모드

| 명령 | 용도 |
| --- | --- |
| `npm run dev` | 평소 개발. Next 개발 서버라 HMR이 빠릅니다. `next.config.ts`의 `initOpenNextCloudflareForDev()` 덕분에 R2/Images 등 Cloudflare 바인딩도 접근 가능합니다. |
| `npm run cf:preview` | 배포 직전 검증. OpenNext로 빌드한 뒤 `wrangler dev`로 실제 workerd 런타임에서 돌립니다. 빌드가 필요해 느리지만 런타임 차이를 잡아냅니다. |

일상 작업은 `npm run dev`를 쓰고, 런타임 관련 변경(서버 코드, 바인딩 사용)을 했을 때만
`npm run cf:preview`로 확인하세요.

### 그 외 명령

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # eslint
npm run cf:build    # OpenNext 빌드만
npm run cf:typegen  # wrangler.jsonc 수정 후 바인딩 타입 재생성
npm run cf:deploy   # 빌드 + wrangler deploy (Phase 6에서 사용)
```

`wrangler.jsonc`의 바인딩을 바꾸면 `npm run cf:typegen`을 다시 돌려 `cloudflare-env.d.ts`를
갱신하세요.

## 데이터베이스 마이그레이션

스키마는 `supabase/migrations/`에 타임스탬프 파일명으로 관리합니다 (Supabase CLI 표준 방식).

```bash
npx supabase login                 # 최초 1회, Supabase 계정 인증
npx supabase link --project-ref <project-ref>   # 이 저장소를 Supabase 프로젝트에 연결

# 로컬(Docker)에서 테스트
npx supabase start                 # 로컬 Postgres + Studio 기동 (Docker 필요)
npx supabase db reset              # 마이그레이션 + supabase/seed.sql 적용

# 새 마이그레이션 추가
npx supabase migration new <설명>   # supabase/migrations/<timestamp>_<설명>.sql 생성

# 원격(프로덕션) Supabase 프로젝트에 반영
npx supabase db push
```

`supabase/seed.sql`은 `db reset` 시 자동 실행되며, 테스트용 location 3개 + hike 1개를 넣습니다
(멤버 승인 플로우는 실제 로그인이 있어야 생기는 `auth.users` 행이 필요해 시드에는 포함하지
않았습니다 — `locations.created_by` / `hikes.created_by`가 nullable인 이유이기도 합니다).

TypeScript 타입(`src/types/`)은 로컬 Supabase가 떠 있을 때 다음으로 생성합니다:

```bash
npx supabase gen types typescript --local > src/types/database.ts
```

이 환경에는 Docker가 없어 이번 Phase에서는 마이그레이션 SQL을 `libpg-query`로 문법만
정적 검증했습니다 (44개 statement 파싱 성공). Docker가 있는 환경에서 `supabase db reset`으로
실제 실행 검증을 한 번 거치는 것을 권장합니다.

## 환경변수

전체 목록과 설명은 [.env.local.example](.env.local.example)을 참고하세요.
`SUPABASE_SERVICE_ROLE_KEY`는 RLS를 우회하므로 서버 코드에서만 사용합니다
(`src/lib/supabase/admin.ts`가 `server-only`로 이를 강제).

프로덕션에서는 시크릿을 `wrangler secret put <NAME>`으로 등록합니다 (Phase 6).

## 인증 (Auth)

`/login`은 **로그인 / 회원가입** 탭으로 나뉘고, 각 탭에서 Google OAuth 또는 이메일+비밀번호를
쓸 수 있습니다. 매직링크(OTP)도 "비밀번호 없이 메일로 로그인 링크 받기"로 남아 있습니다 —
비밀번호가 생기기 전에 가입한 사람과, 비밀번호를 두고 싶지 않은 사람을 위한 대체 수단입니다.

비밀번호를 도입한 이유는 매직링크만으로는 **재방문 로그인이 매번 메일함 왕복**이기 때문입니다.
`signInWithOtp`는 가입과 로그인이 같은 API라 탭을 나누는 것만으로는 해결되지 않습니다.
마지막에 쓴 이메일 주소는 브라우저 `localStorage`에 기억해 로그인 탭에 채워둡니다
(비밀번호는 저장하지 않습니다).

### Supabase 대시보드 설정 (최초 1회)

- **Authentication → URL Configuration**: Site URL과 Redirect URLs에
  `http://localhost:3000/auth/callback`, `https://khuac.com/auth/callback` 등록
- **Authentication → Providers → Google**: [Google Cloud Console](https://console.cloud.google.com/apis/credentials)에서
  OAuth 2.0 클라이언트 ID 발급 후 Client ID/Secret 등록. 승인된 리디렉션 URI는 Supabase가
  알려주는 `https://<project-ref>.supabase.co/auth/v1/callback` 값 사용
- **Authentication → SMTP Settings**: 커스텀 SMTP(Resend 등) 등록 — **필수**.
  Supabase 기본 발신자는 시간당 몇 통으로 제한되어 부원 30명 가입을 감당하지 못하고,
  메일 템플릿도 유료 플랜 없이는 바꿀 수 없습니다
- **Authentication → Email Templates**: 링크를 `token_hash` 형식으로 변경. 기본값인 PKCE
  `code` 방식은 **링크를 요청한 브라우저에서만** 열리므로, PC에서 요청하고 폰에서 메일을
  열면 실패합니다 (`/auth/callback`은 두 형식을 모두 처리하도록 이미 구현돼 있습니다)

### 비밀번호 재설정

`/login`의 "비밀번호를 잊으셨나요?" → `resetPasswordForEmail` → 메일의 링크가
`/auth/callback`을 거쳐 `/auth/reset-password`로 들어옵니다. 이 경로는 복구 세션이 살아 있는
상태로 열리므로, 미들웨어에서 승인 상태와 무관하게 통과시킵니다 — 비밀번호를 잊은 것과
가입 승인 여부는 상관이 없습니다.

### 가입 승인 흐름

새 유저가 로그인하면 `handle_new_user` 트리거(마이그레이션
[20260907231501_auth_pending_approval.sql](supabase/migrations/20260907231501_auth_pending_approval.sql))가
`members` 테이블에 `role='pending'` 행을 자동 생성합니다. Auth Webhook 대신 DB 트리거를 쓴
이유: `auth.users` insert와 같은 트랜잭션에서 동기 실행되어, 인증은 됐는데 `members` 행이
없는 상태(웹훅 실패/타임아웃)가 아예 발생하지 않습니다.

이름은 가입 과정에서 묻지 않습니다 — Google은 프로필 이름을, 매직링크는 이메일의 @ 앞부분을
그대로 씁니다. 그래서 `/pending-approval`에 이름 입력란이 있고, 승인 후에는 지도 상단바에서
고칠 수 있습니다. 관리자가 승인 큐에서 읽는 이름이 이것이므로, 대기 화면에서 고치는 것이
기본 흐름입니다.

| 역할 | 접근 가능 범위 |
| --- | --- |
| 비로그인 | `/login`, `/auth/*`, `/privacy`만 접근 가능, 그 외는 `/login`으로 리다이렉트 |
| `pending` | `/pending-approval`(+ `/auth/reset-password`)만 접근 가능 |
| `member` | 일반 페이지 접근 가능, `/admin/*` 차단 |
| `admin` | 전체 접근 가능, `/admin/members`에서 승인/거절 |

승인은 `role`을 `member`로 변경하고, 거절은 Admin API로 `auth.users` 행 자체를 삭제합니다
(members 행은 `ON DELETE CASCADE`로 함께 삭제 — 거절된 사람은 재가입하려면 처음부터 다시
가입해야 합니다).

### 테스트 시나리오

1. `/login`의 **회원가입** 탭에서 이메일+비밀번호로 가입 → 확인 메일의 링크 클릭 →
   `/auth/callback` → `/pending-approval`로 리다이렉트 → 거기서 이름 입력
2. 로그아웃 후 **로그인** 탭에서 같은 이메일+비밀번호로 즉시 로그인되는지 확인
   (메일함을 거치지 않아야 함)
3. "비밀번호를 잊으셨나요?" → 재설정 메일 → `/auth/reset-password`에서 새 비밀번호 →
   그 비밀번호로 로그인
4. PC에서 메일을 요청하고 **폰에서** 링크를 열어도 동작하는지 (`token_hash` 템플릿 확인)
5. Google 로그인 시 계정 선택 화면이 매번 뜨는지 (`prompt=select_account`)
6. 같은 계정으로 `/`나 `/admin/members`에 직접 접근 시도 → `/pending-approval`로 다시 리다이렉트되는지 확인
7. Supabase Studio(또는 다른 admin 계정)에서 해당 멤버를 `role='admin'`으로 수동 승격
8. admin 계정으로 로그인 → `/admin/members`에서 대기 중인 신규 가입자에게 "승인" 클릭
9. 승인된 계정으로 다시 로그인 → `/`에 정상 접근되는지, `/admin/members`는 차단되는지 확인
10. 다른 pending 계정에 "거절" 클릭 → 해당 계정으로 로그인 시도 시 Supabase Auth 단계에서부터 실패하는지 확인 (auth.users 행 자체가 삭제됨)

## 폴더 구조

```
src/
  middleware.ts        # 인증/승인 상태에 따른 라우트 접근 제어
  app/
    login/              # 로그인/회원가입 탭 (Google OAuth + 이메일·비밀번호 + 매직링크)
    auth/callback/       # OAuth/메일 링크 콜백 (code 교환 / token_hash 검증)
    auth/reset-password/ # 비밀번호 재설정 (복구 링크가 도착하는 곳)
    pending-approval/    # role='pending' 유저 전용 대기 페이지
    map/                  # 지도 중심 화면 (page → map-shell → map-view / side-panel / hike-detail)
    hikes/[id]/           # 산행 갤러리 딥링크 (지도 밖에서 바로 열 때)
    privacy/              # 개인정보처리방침 (Google OAuth 심사에 필요한 공개 페이지)
    photos/upload/        # 사진 업로드 (presign → R2 직접 업로드 → EXIF/위치 매칭)
    api/images/[...key]/  # 리사이징 + R2 캐시
    admin/
      members/            # 가입 승인/거절 (admin 전용)
      photos/unmatched/   # 위치 매칭 대기 사진 처리 (admin 전용)
  components/
    sign-out-button.tsx
    auth-buttons.tsx    # 로그인/회원가입 탭 + Google·비밀번호·매직링크
    photo-lightbox.tsx  # 사진 뷰어 (지도 패널 / 갤러리 페이지 공용)
  lib/
    env.ts             # 필수 환경변수 조회 헬퍼
    supabase/
      client.ts        # 브라우저용 (createBrowserClient)
      server.ts        # 서버 컴포넌트/라우트용 (createServerClient, 쿠키 기반 세션)
      admin.ts         # service role 전용, RLS 우회
      middleware.ts    # 미들웨어 전용 클라이언트 (쿠키 갱신)
      require-role.ts  # 서버 액션/라우트용 승인멤버·admin 세션 체크
    r2/
      client.ts         # aws4fetch 기반 presigned URL + S3 API 읽기/쓰기/삭제
    photos/
      limits.ts         # 허용 이미지 형식·용량 (동영상 차단)
    images/
      url.ts             # 썸네일/프리뷰 URL 빌더 (/api/images/... 링크)
    gps/
      haversine.ts        # 순수 거리 계산 함수 (유닛테스트 있음)
      validate.ts          # EXIF GPS 유효성 검사 (0,0 등 무효값 처리)
      exif.ts               # exifr로 GPS/촬영일/크기 파싱, 실패해도 안 죽음
      match-photo-location.ts # 4+1가지 매칭 케이스 판정 (순수 함수, 유닛테스트 있음)
      track.ts              # GPX 파싱·축약·거리 계산, 사진 GPS 폴백 경로 (유닛테스트 있음)
  types/
    database.ts        # 수기 작성 DB 타입 (Docker 생기면 생성 타입으로 교체)
```

## 사진 업로드 파이프라인 (Phase 3)

1. `/photos/upload`에서 산행(선택)과 파일을 고르면 `presignPhotoUpload` 서버 액션이
   R2 presigned PUT URL을 발급 (`src/lib/r2/client.ts`, `aws4fetch` 사용 — 전체 AWS SDK
   대신 Workers 런타임에 맞는 5KB짜리 경량 SigV4 서명 라이브러리를 씀)
2. 브라우저가 그 URL로 원본을 R2에 직접 PUT (서버 경유 없음)
3. `processUploadedPhoto` 서버 액션이 R2의 S3 API로 방금 올라온 원본을 읽어 `exifr`로 EXIF
   파싱 → `matchPhotoLocation`(`src/lib/gps/match-photo-location.ts`)으로 위치 매칭 →
   `photos` 테이블에 insert
4. 썸네일/프리뷰는 `/api/images/<storage_key>?w=400&q=75` 요청 시 `env.IMAGES` 바인딩으로
   변환하고, 결과를 R2의 `derived/w400q75/...` 키에 캐시합니다
   (`src/app/api/images/[...key]/route.ts`). Cloudflare가 이미지 변환을 **월별 고유
   (이미지, 옵션) 조합 단위로** 과금하기 때문에, 캐시가 없으면 아카이브를 훑는 달마다
   전체가 다시 과금됩니다. 썸네일은 수십 KB라 저장이 훨씬 쌉니다.
   이 라우트는 그 자체로 `requireApprovedMember()`를 체크합니다. `middleware.ts`의 정적
   파일 확장자 제외 규칙(`.jpg`, `.png` 등으로 끝나는 경로는 미들웨어를 건너뜀) 때문에
   storage key가 확장자를 포함하면 미들웨어가 이 라우트를 아예 안 거치므로, 라우트 자체의
   인증 체크가 유일한 방어선입니다.

### 서버에서 R2를 읽는 방식

서버 측 읽기/쓰기는 Workers 바인딩이 아니라 **R2의 S3 API**(`src/lib/r2/client.ts`)를
씁니다. 브라우저는 presigned URL로 *실제* R2에 올리는데, `next dev`에서 R2 바인딩은
Miniflare의 로컬 에뮬레이션 버킷이라 방금 올라온 객체를 절대 못 봅니다. S3 경로로 통일하면
로컬과 배포가 같게 동작합니다. 그래서 `wrangler.jsonc`에는 사진용 R2 바인딩이 없고,
`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME`을 씁니다.

### 동영상 차단

`src/lib/photos/limits.ts`에 허용 형식(JPEG/PNG/WebP/HEIC)과 용량 상한(30MB)을 두고,
파일 선택 필터 → 클라이언트 필터 → **서버 검증** 3단계로 막습니다. presigned PUT은
클라이언트가 무엇이든 올릴 수 있으므로 업로드 완료 후 실제 파일을 다시 읽어 형식·크기를
확인하고, 어긋나면 R2에서 삭제합니다. 동영상을 막는 이유는 용량(4K 1분 > 사진 수백 장)뿐
아니라 `exifr`도 Images 바인딩도 영상을 처리하지 못해 썸네일이 깨지기 때문입니다.

### 위치 매칭 로직 (핵심)

`matchPhotoLocation`이 판정하는 경우의 수 — 처음 4개는 스펙에서 요구한 테스트 케이스,
5번째는 스펙 산문에는 명시적으로 없지만 `no_gps` enum 값이 실제로 쓰이려면 필요한 경우라
같이 추가함(직접 실행하며 이렇게 해석했다는 점 참고):

| # | EXIF GPS | 산행(hike) 선택 | 산행에 위치 있음 | 결과 status |
| - | - | - | - | - |
| 1 | 있음, 반경 500m 내 등록 장소 있음 | - | - | `auto_matched` |
| 2 | 있음, 반경 내 등록 장소 없음 | - | - | `manual_pending` |
| 3 | 없음 | 선택함 | 있음 | `manual_matched` |
| 4 | 없음 | 선택함 | 없음 | `manual_pending` |
| 5 | 없음 | 선택 안 함 | - | `no_gps` |

각 케이스는 `src/lib/gps/match-photo-location.test.ts`에 유닛테스트로 있습니다
(`npm run test`). Haversine 거리 계산 자체도 `src/lib/gps/haversine.test.ts`에서 별도
검증(반경 경계값 포함).

### 필요한 R2 버킷

```bash
wrangler r2 bucket create khuac
```

`.env.local`에는 `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME`
(=`khuac`)가 있어야 presign이 동작합니다 (Cloudflare 대시보드 → R2 → Manage API
Tokens에서 발급). `wrangler.jsonc`의 `PHOTOS_BUCKET` 바인딩은 서버 코드(R2 읽기, 이미지
리사이징)에서만 쓰이고, 브라우저의 직접 업로드는 이 S3 호환 자격증명으로 별도 인증합니다.

## 지도 (Phase 4)

`/map`에서 좌표가 등록된 모든 장소를 마커로 보여줍니다. 마커에는 그 장소에 매칭된 사진 수가
배지로 붙고(Phase 3의 `photos.matched_location_id` 기준), 마커를 누르면 InfoWindow에 그
장소의 산행 목록이 뜨며 각 산행은 `/hikes/<id>` 갤러리로 연결됩니다 (갤러리 페이지 자체는
Phase 5에서 만듭니다).

국내/해외 장소가 섞여 있어도 초기 화면이 맞도록, 마커들의 bounding box로 `fitBounds`를
겁니다(`src/app/map/map-view.tsx`의 `FitBounds`). 장소가 하나뿐이면 `fitBounds`가 최대
줌까지 당겨버려서 대신 적당한 줌 레벨로 고정합니다.

Maps SDK는 `next/dynamic`의 `ssr: false`로 클라이언트에서만 로드합니다. App Router에서
`ssr: false`는 서버 컴포넌트에서 못 쓰기 때문에, 페이지(서버) → `map-loader.tsx`(클라이언트,
동적 import + API 키 검사) → `map-view.tsx`(실제 지도) 3단 구조입니다.

### Google Cloud Console 설정 체크리스트

카드 등록이 필수이고 사용량 기반 과금이라, 키를 만들고 **반드시** 아래 제한을 걸어주세요.

- [ ] 프로젝트 생성 후 **Maps JavaScript API** 활성화
- [ ] 결제 계정 연결 (Maps Platform은 카드 등록 필수)
- [ ] API 키 발급 후 **애플리케이션 제한 → HTTP 리퍼러**:
      `https://khuac.com/*`, `http://localhost:3000/*`
- [ ] **API 제한 → Maps JavaScript API** 하나만 선택
- [ ] **할당량(Quotas)**에서 일일 요청 상한 설정 (실수/유출 시 과금 폭탄 방지)
- [ ] 결제 **예산 및 알림**에서 임계값 알림 설정
- [ ] 발급한 키를 `.env.local`의 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`에 넣기

`NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`는 선택입니다. 비워두면 Google의 `DEMO_MAP_ID`로 동작하며
(Advanced Marker에는 Map ID가 필요합니다), Cloud 기반 지도 스타일을 쓰고 싶을 때만 실제
Map ID를 발급해 넣으면 됩니다. 키가 아예 없으면 지도 대신 설정 안내 문구가 표시됩니다.

## 배포 전 준비 (Phase 6에서 진행)

- OpenNext 증분 캐시용 R2 버킷 생성:
  `wrangler r2 bucket create khuac-homepage-opennext-cache`
- 사진용 R2 버킷 생성: `wrangler r2 bucket create khuac`
- khuac.com을 Worker의 Custom Domain으로 연결
- 시크릿 등록 (`wrangler secret put ...`)

## 알려진 이슈

- `npm audit`이 `postcss` 취약점 2건을 보고합니다. Next 15.5.25가 내부적으로 물고 있는
  버전이라 Next 16으로 올려야만 해소되며, 빌드 타임 도구 의존성이라 런타임 노출은 없습니다.
- `esbuild`를 `package.json`에 직접 devDependency로 박아뒀습니다(`^0.28.0`). `@opennextjs/cloudflare`가
  `npm run cf:build` 실행 시 `esbuild`를 bare import로 불러오는데 정작 자기 `package.json`에는
  devDependency로만 적어놔서, 우리 쪽에서 하나 hoist되게 안 해주면 `ERR_MODULE_NOT_FOUND`가 남
  (vitest가 끌고 오는 `vite`의 esbuild peer 범위 `^0.27.0 || ^0.28.0`과도 맞춰야 해서 이 버전대로 고정).
  Next 16 + 어댑터 조합이 충분히 안정화되면 그때 올리는 것을 권장합니다.
