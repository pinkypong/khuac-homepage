# khuac-homepage

산악부 홈페이지. 산행 기록과 사진을 모아두고, 사진의 EXIF GPS로 산행 장소를 자동 매핑하는 것이 핵심입니다.

## 스택

| 영역 | 선택 |
| --- | --- |
| 프레임워크 | Next.js 15.5.25 (App Router, TypeScript, Tailwind CSS v4) |
| 호스팅 | Cloudflare Workers (`@opennextjs/cloudflare` 어댑터) |
| DB / Auth | Supabase (Postgres, RLS, pgvector) |
| 사진 저장소 | Cloudflare R2 (원본만 저장) |
| 이미지 리사이징 | Cloudflare Images 바인딩 (요청 시점 즉석 변환) |
| 지도 | Google Maps Platform |

> **네이티브 바이너리 금지**: Workers 런타임은 V8 isolate 기반이라 `sharp` 같은 네이티브 모듈을
> 실행할 수 없습니다. 썸네일/프리뷰는 미리 만들어 저장하지 않고, `wrangler.jsonc`의 `IMAGES`
> 바인딩으로 요청 시점에 변환합니다.

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

## 폴더 구조

```
src/
  app/                 # 라우트 (App Router)
  components/
  lib/
    env.ts             # 필수 환경변수 조회 헬퍼
    supabase/
      client.ts        # 브라우저용 (createBrowserClient)
      server.ts        # 서버 컴포넌트/라우트용 (createServerClient, 쿠키 기반 세션)
      admin.ts         # service role 전용, RLS 우회
    r2/                # R2 클라이언트 / presigned URL      (Phase 3)
    images/            # 리사이징 URL 빌더                   (Phase 3)
    gps/               # EXIF 파싱, Haversine 거리 계산      (Phase 3)
  types/               # DB 타입                            (Phase 1)
```

## 배포 전 준비 (Phase 6에서 진행)

- OpenNext 증분 캐시용 R2 버킷 생성:
  `wrangler r2 bucket create khuac-homepage-opennext-cache`
- khuac.com을 Worker의 Custom Domain으로 연결
- 시크릿 등록 (`wrangler secret put ...`)

## 알려진 이슈

- `npm audit`이 `postcss` 취약점 2건을 보고합니다. Next 15.5.25가 내부적으로 물고 있는
  버전이라 Next 16으로 올려야만 해소되며, 빌드 타임 도구 의존성이라 런타임 노출은 없습니다.
  Next 16 + 어댑터 조합이 충분히 안정화되면 그때 올리는 것을 권장합니다.
