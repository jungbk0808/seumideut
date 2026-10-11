# 메모 DB 연결 기반

2026.10.11: 소유자가 환경변수 입력·원격 SQL 실행·데스크톱 복귀 주소 등록을 완료했다고 보고했다. Google 로그인·재실행 유지·로그아웃 후 재실행·재로그인과 기존 메모 보존도 소유자가 정상 확인했다고 보고했다. 메모 업로드·동기화는 아직 구현하지 않았다.

## 앱 구분

- `apps/desktop`: Tauri 창 안에서 실행하는 React UI. `npm run dev:desktop`으로 브라우저에서 여는 화면도 **데스크톱 UI 개발용**이다. 브라우저 실행 시 메모는 개발용 `localStorage`에 저장된다.
- `apps/web`: 향후 만들 독립 웹 앱의 위치. 별도 화면·스타일·앱 진입점으로 구현한다. 현재 이 폴더와 웹 앱은 없다.
- 두 앱은 같은 Supabase 계정과 `public.notes` 데이터 계약을 사용한다. 웹 UI를 데스크톱 화면에 맞출 필요는 없다. Tauri 창 제어·핀·위젯 동작은 데스크톱에 둔다.

## 데스크톱 연결 정보

1. `apps/desktop/.env.example`을 `apps/desktop/.env.local`로 복사한다.
2. 본인 프로젝트의 Project URL과 **Publishable key**를 입력한다.
3. 실행 중인 Vite/Tauri 개발 서버를 다시 시작한다.

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<your-key>
```

`.env.local`은 Git에서 제외된다. Google Client Secret, DB 비밀번호, Supabase Secret key/service_role 키는 넣지 않는다. 이 구현은 새 Publishable key만 받으며, 기존 JWT 형식 anon 키는 받지 않는다.

`apps/desktop/src/cloud/client.ts`의 `getSupabaseClient()`는 전체 메모 창의 설정에서 필요할 때 생성된다. 환경변수 둘 다 없으면 `null`, 한쪽만 있거나 형식이 잘못되면 값이 노출되지 않는 설정 오류를 반환한다. 설정이 없어도 로컬 메모는 사용할 수 있다. 환경변수만 추가해도 메모를 업로드하거나 로그인하지는 않는다.

## Google 로그인과 세션 보관

- 전체 메모 → 설정 → `Google로 로그인`에서 시작한다. Windows에서는 기본 브라우저를 열고, 임시 loopback 수신기 `http://127.0.0.1:1421/auth/callback/<무작위 요청 ID>`로 복귀한다. Supabase Redirect URLs에 `http://127.0.0.1:1421/auth/callback/**`를 등록한다.
- PKCE 코드를 한 번만 교환하며 요청 ID가 다른 응답은 무시한다. 취소·실패·5분 시간 초과 후 수신기와 verifier를 정리하고 재시도할 수 있다. 앱의 전체 메모 창을 닫으면 수신기도 종료된다.
- Windows 세션은 메모 폴더와 별개인 앱 데이터 폴더의 `auth-session.dpapi`에 현재 Windows 사용자용 DPAPI로 암호화해 저장한다. 자동 갱신·재실행 복구를 설정했으며, 로그인 처리는 전체 메모 창 한 곳에서만 실행한다. 위젯에 별도 인증 클라이언트를 만들지 않는다.
- 브라우저 개발 화면은 `localStorage` 세션과 `sessionStorage`의 요청 기록을 사용한다. 복귀 URL의 인증 코드·오류·토큰 관련 값을 지우고 명시적으로 교환한다. 이 화면은 독립 웹 앱이 아니다.
- 로그아웃은 이 앱의 세션에 적용한다. 로컬 메모 파일은 로그인·로그아웃 때 변경하거나 업로드하지 않는다. 계정별 메모 저장·전환은 후속 구현이다. Windows 외 네이티브 플랫폼의 인증 저장소는 아직 지원하지 않는다.

## 테이블 적용

소유자가 SQL Editor에서 아래 마이그레이션 실행에 성공했다고 보고했다. 읽기 전용 원격 확인에서 Google provider 활성화와 비로그인 메모 조회 차단(HTTP 401, `42501`)을 확인했다. 로그인한 실제 두 계정의 원격 RLS 검증은 아직 남아 있다.

소유자가 적용하는 경우:

1. 대상 Supabase 프로젝트의 SQL Editor를 연다.
2. `supabase/migrations/20261008000100_create_notes.sql`의 전체 내용을 실행한다.
3. `public.notes` 테이블, RLS 활성화, `notes_select_own`·`notes_insert_own`·`notes_update_own` 정책을 확인한다.

이미 `public.notes`가 있다면 기존 테이블을 지우거나 이 SQL을 반복 실행하지 않는다. 기존 스키마를 확인하고 추가 마이그레이션을 작성한다. 이 SQL은 하나의 트랜잭션으로 적용되며 기존 테이블이 있으면 실패한다. CLI를 도입하면 이 파일을 마이그레이션 이력에 반영한 뒤 후속 변경을 적용한다.

## 데이터 계약과 권한

| 기존 Note | DB |
|---|---|
| 계정 소유권 (로컬에는 없음) | `user_id`, `auth.users.id` 참조 |
| `id` | `id` (text, 기존 문자열 ID 보존) |
| `title`, `content` | `title`, `content` (마크다운 원문) |
| `createdAt`, `updatedAt`, `deletedAt` | `created_at`, `updated_at`, `deleted_at` (timestamptz) |
| `isPinned`, `schemaVersion` | `is_pinned`, `schema_version` |

- 기본키는 `(user_id, id)`. 계정 간 기존 ID가 같아도 서로 다른 메모다. 같은 계정·ID의 중복 INSERT는 실패하여 기존 메모를 덮어쓰지 않는다.
- 로그인한 사용자는 본인 메모만 조회·추가·수정할 수 있다. 소유권·ID·생성 시각은 추가 후 바꿀 수 없다. 비로그인 사용자는 접근할 수 없다.
- 삭제는 `deleted_at` 수정으로 처리한다. 일반 앱 사용자에게 물리 DELETE 권한은 없다. 일반 목록은 `deleted_at is null`로 조회하고, 동기화는 삭제 기록도 읽는다.
- 계정 자체 삭제는 FK의 `on delete cascade`에 따라 해당 계정의 메모도 삭제한다.
- 저장 시각은 이 단계에서 입력값을 보존한다. 서버 버전·동시 수정 충돌 방지, 삭제 후 오래된 변경의 재업로드 처리, 계정별 로컬 데이터 분리, `.md` 백업·가져오기 정책은 후속 동기화 구현 대상이다. 이 테이블만으로 동기화가 완성되지는 않는다.
- 클라이언트 DB 타입은 마이그레이션과 맞춘 수동 계약이다. 원격 적용 후 생성한 타입과 비교한다.

## 검증과 다음 순서

`npm test`에서 PGlite의 메모리 PostgreSQL 엔진에 실제 SQL을 적용하고 권한이 없는 두 역할과 사용자 두 명을 구성한다. 원문·메타데이터 보존, 계정별 조회, 소유자 수정·soft delete, 비로그인·다른 사용자 접근 차단, 소유권 변경·물리 삭제 차단을 검사한다. Supabase Auth의 `auth.uid()`는 테스트용 함수로 대체하며 원격 인증·Data API는 이 테스트에 포함하지 않는다.

`npm test`(36개)와 `npm run build`는 통과했다. 인증 테스트는 성공·취소·시간 초과·교환 실패·로그아웃 실패·세션 복구와 브라우저 복귀 URL 검증을 포함한다. Rust 테스트는 Windows 암호화 저장·교체·verifier 제거와 callback 파싱을 포함한다. 브라우저에서 설정 화면과 활성화된 로그인 버튼을 확인했다. 실제 Windows Google 로그인·재실행 유지·로그아웃은 [수동 확인 절차](../docs/mvp-qa-checklist.md)를 따른다.

빌드는 기존 번들 크기 경고를 표시한다. `npm audit`에 남은 3개 항목은 기존 Vite·esbuild·source-map-js 관련이며 이번 SDK·테스트 엔진 관련 항목은 없었다. 도구 체인 업데이트는 별도 작업으로 처리한다.

1. 완료 보고: 환경변수 입력과 원격 SQL 적용, 데스크톱 복귀 주소 등록.
2. 구현·소유자 실제 계정 확인 완료: Windows Google 로그인·로그아웃, 재실행 세션 복구·재로그인과 기존 메모 보존. 취소·시간 초과의 실제 브라우저 확인은 별도 항목이다.
3. `.md` 보존·가져오기와 계정별 저장소, 재전송·충돌 정책 및 동기화.
4. 독립 웹 UI·메모 기능 구현.
5. 실제 두 계정 접근 차단과 PC·웹 통합 검증 후 7일 실사용.

참고: [Supabase 클라이언트](https://supabase.com/docs/reference/javascript/initializing), [사용자별 RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PGlite](https://pglite.dev/docs/).
