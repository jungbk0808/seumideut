# 외부 서비스 설정: Supabase와 Google 로그인

갱신 기준: 2026.10.11. 대시보드 메뉴 이름은 변경될 수 있으므로 같은 기능의 메뉴를 찾는다.

## 현재 상태와 적용 범위

- 소유자가 Supabase 프로젝트 생성·Google provider 저장·앱 환경변수 입력·SQL 실행·데스크톱 복귀 주소 등록을 완료했다고 보고했다. 원격 읽기 확인에서 Google provider 활성화와 비로그인 메모 조회 차단을 확인했다. Windows 실제 Google 로그인·재실행 유지·로그아웃 후 재실행·재로그인과 기존 메모 보존은 소유자가 정상 확인했다고 보고했다.
- MVP 로그인은 Google만 지원한다. 네이버·카카오 등은 향후 추가 대상으로, 각각의 지원 방식과 계정 연결 정책을 별도로 확인한다.
- PC와 웹은 같은 계정의 메모를 공유한다. 향후 모바일 앱도 같은 사용자·메모 구조를 사용한다. 이번 설정 작업은 모바일 앱 구현을 포함하지 않는다.
- 기존 데스크톱 `.md` 메모를 보존한다. 가져오기, 오프라인 변경 재전송, 충돌 처리, 로그아웃·계정 전환 시 로컬 데이터 분리는 구현 단계에서 정한다.
- 현재 앱의 메모 저장은 로컬 방식이다. SDK·메모 테이블·RLS 기반과 Google 로그인·로그아웃·Windows 세션 보관을 구현했다. 메모 동기화는 후속 작업이다. 적용 절차와 인증 저장 방식은 [DB 연결 기반 문서](../supabase/README.md)를 따른다.

## 1. Supabase 가입과 프로젝트 생성

1. [Supabase Dashboard](https://supabase.com/dashboard)에서 가입하고 로그인한다.
2. 개인용 Organization을 만들고 `New project`를 선택한다.
3. 프로젝트 이름은 개발용임을 알아볼 수 있게 정한다. 예: `memo-app-dev`.
4. DB 비밀번호를 생성하고 비밀번호 관리자에 보관한다.
5. 초기 개발은 Free 플랜으로 시작한다.
6. 한국 중심 사용을 위해 `Specific regions → Northeast Asia (Seoul)`, `ap-northeast-2`를 권장한다.

`General regions`는 넓은 지역 안에서 Supabase가 서버 수용량에 따라 위치를 배정한다. `Specific regions`는 정확한 AWS 리전을 지정한다. 각 프로젝트의 주 DB는 하나의 리전에 배치된다. 실제로 선택한 리전은 Dashboard에서 확인한다.

프로젝트 생성 화면의 Security 옵션은 다음 조합을 사용한다.

| 옵션 | 선택 | 의미 |
|---|---|---|
| Enable Data API | 켜기 | 앱의 Supabase 클라이언트에서 DB를 조회·저장할 API 활성화 |
| Automatically expose new tables | 끄기 | 새 테이블에 API 역할의 접근 권한을 자동 부여하지 않음 |
| Enable automatic RLS | 켜기 | public 스키마의 새 테이블에 행 단위 접근 제어 활성화 |

RLS를 켜도 사용자별 접근 정책은 자동으로 만들어지지 않는다. 메모 테이블을 만들 때 필요한 `GRANT`와 본인 메모에만 접근하는 RLS 정책을 함께 작성해야 한다. Supabase GitHub 저장소 연결은 초기 DB 연결에 필수가 아니며, DB 변경 파일과 배포 방식을 마련한 뒤 설정한다.

참고: [리전](https://supabase.com/docs/guides/platform/regions), [테이블 자동 권한 변경](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 2. 앱 연결 정보 확인

프로젝트의 `Connect`에서 Project URL과 Publishable key를 확인한다. 키는 `Settings → API Keys`에서도 확인할 수 있다.

| 값 | 사용 위치 |
|---|---|
| Project URL: `https://<project-ref>.supabase.co` | 앱 환경변수 |
| Publishable key: `sb_publishable_...` | 앱 환경변수. 사용자 인증·RLS와 함께 사용 |
| Google Client ID | Supabase Google provider 설정 |
| Google Client Secret | Supabase Google provider 설정에만 입력 |
| DB 비밀번호, Secret key, 기존 service_role 키 | 클라이언트 앱·문서·Git에 넣지 않음 |

Publishable key는 사용자 기기에 포함될 수 있는 공개용 키다. 비공개 메모 보호는 로그인, 테이블 권한, RLS로 구현한다. 실제 키와 비밀번호는 이 문서에 기록하지 않는다.

Vite 앱 연결 시 사용할 환경변수 이름은 다음과 같다. `apps/desktop/.env.example`을 `.env.local`로 복사한 뒤 실제 공개 연결 값을 입력한다.

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<your-key>
```

앱 폴더의 `.env.local`을 사용한다. 저장소 `.gitignore`는 `.env`·`.env.*`를 제외하고 `.env.example`만 허용한다. `VITE_` 값은 빌드 결과에 포함되므로 비밀키를 넣지 않는다. 설정 화면의 로그인에서 이 값을 사용하며 메모 저장은 아직 로컬 방식이다.

참고: [API 키](https://supabase.com/docs/guides/getting-started/api-keys), [React 연결](https://supabase.com/docs/guides/getting-started/quickstarts/reactjs).

## 3. Google 로그인 설정

### Supabase 콜백 주소 확보

`Authentication → Sign In / Providers → Google`에서 Callback URL을 복사한다. 메뉴에 따라 `Providers`로 표시될 수 있다.

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

### Google Cloud 프로젝트와 동의 화면

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 만들거나 기존 프로젝트를 선택한다. 예: `memo-app`.
2. `Google Auth Platform`에서 초기 설정을 시작한다.
3. Branding의 앱 이름(예: `Memo App`), 지원 이메일, 개발자 연락 이메일을 입력한다.
4. Audience는 일반 Google 계정으로 로그인할 수 있는 `External`을 선택한다.
5. 개발 중 Testing 상태를 사용한다면 `Audience → Test users`에 본인 Google 계정을 추가한다.
6. `Data Access`에서 `openid`, 이메일, 프로필 범위를 확인한다. 메모 앱 로그인에는 Drive 등 추가 데이터 권한이 필요하지 않다.

### OAuth 클라이언트 생성

`Clients → Create client`에서 다음 값을 설정한다.

| 항목 | 값 |
|---|---|
| Application type | Web application |
| Name | 예: Memo App Development |
| Authorized JavaScript origins | `http://127.0.0.1:1420` |
| Authorized redirect URIs | 위에서 복사한 Supabase Callback URL |

현재 개발 주소는 `apps/desktop/vite.config.ts`의 host·port 기준이다. `localhost`와 `127.0.0.1`은 서로 다른 origin이므로 실제 사용 주소와 일치시킨다. Google의 redirect URI에는 앱 주소 대신 Supabase 콜백 주소를 넣는다.

### Supabase에 인증 정보 등록

1. Supabase Google provider의 `Enable Google provider`를 켠다.
2. Google에서 발급한 Client ID와 Client Secret을 입력한다.
3. Save를 누른다.

Google Client Secret은 채팅이나 앱 환경변수에 전달하지 않는다. 데스크톱의 외부 브라우저 로그인 복귀는 아래 loopback 주소를 사용한다.

참고: [Supabase Google 로그인 설정](https://supabase.com/docs/guides/auth/social-login/auth-google).

## 4. 로그인 후 앱 복귀 주소

Google provider 저장 후에도 Supabase의 `Authentication → URL Configuration`을 설정해야 한다. 개발 단계에서는 다음 값을 사용한다.

| 항목 | 값 |
|---|---|
| Site URL | `http://127.0.0.1:1420` |
| Redirect URLs (브라우저 개발 화면) | `http://127.0.0.1:1420/**` |
| Redirect URLs (Windows 앱) | `http://127.0.0.1:1421/auth/callback/**` 추가, 기존 주소 유지 |

소유자가 Windows 앱 주소를 추가하고 저장했다고 보고했다. 1420은 브라우저 개발 화면, 1421은 로그인 중에만 열리는 Windows 앱 복귀 수신기다. 앱은 `/auth/callback/` 뒤의 무작위 요청 ID를 검사하므로 이 경로의 `/**`가 필요하다. 웹 운영 주소는 배포 시 정확한 콜백 경로를 별도로 등록한다.

두 종류의 주소를 구분한다.

- Google의 Authorized redirect URIs: Google → Supabase로 돌아오는 주소.
- Supabase의 Redirect URLs: Supabase → 우리 앱으로 돌아오는 주소.

독립 웹 배포 주소는 구현·배포 시 추가 등록한다. 모바일은 구현 단계에서 플랫폼별 OAuth·앱 복귀 설정을 추가한다.

MVP를 Google 로그인만 제공하려면 Supabase의 로그인 provider 목록에서 Email과 Anonymous Sign-In 등 다른 로그인 방식의 활성화 상태도 확인하고 사용하지 않는 방식은 끈다. 기존 사용자가 있는 프로젝트에서는 영향 범위를 먼저 확인한다.

참고: [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## 5. 이후 구현과 검증

외부 서비스 초기 설정 후 개발 작업으로 진행할 항목이다.

1. 완료: 앱 환경변수 제외 규칙·예제와 타입 지정 Supabase 클라이언트 추가.
2. 로컬 검증·소유자 원격 적용 보고 완료: 사용자 ID를 기준으로 메모 소유권을 표현하는 테이블, 접근 권한, RLS 마이그레이션. 실제 두 계정 접근 검증은 남아 있다.
3. 구현·소유자 확인 완료: Google 로그인·로그아웃과 Windows 복귀, 암호화 세션 저장. 실제 계정 로그인·앱 재실행 유지·로그아웃 후 재실행·재로그인과 메모 보존 확인 보고.
4. 기존 로컬 메모 백업·가져오기 및 계정별 데이터 분리 정책 구현.
5. 오프라인 변경, 재전송, 삭제 상태, 동시 수정 충돌 처리 구현.
6. 독립 웹 앱을 만들고 배포 주소의 인증 설정 추가.
7. 동일 계정의 PC·웹 저장/복구, 다른 계정 접근 차단, 로그아웃, 충돌·오프라인 시나리오 검증.

프로젝트 URL과 Publishable key는 연결 단계에서 필요하다. DB 마이그레이션을 원격으로 적용하려면 프로젝트에 접속 가능한 연결 수단이나 소유자의 SQL 실행이 필요하다. Google provider 저장만으로 테이블·권한·동기화가 생성되지는 않는다.

## Google 로그인 브랜딩 TODO

2026.10.11 소유자 요청으로 보류한다. 서비스 소개·개인정보처리방침·이용약관의 공개 페이지와 링크가 아직 없으므로, 이를 준비한 뒤 Google 브랜드 검증과 게시를 진행한다. 백로그의 `TASK-033`에서 추적한다.

- [ ] 서비스 배포 주소·소유 도메인과 실제 데이터 처리 방식을 확정한다.
- [ ] 서비스 소개·개인정보처리방침·이용약관 페이지를 작성하고 로그인 없이 접근 가능한 URL로 배포한다.
- [ ] Google Auth Platform → Branding에 앱 이름 `스미듯`과 페이지 링크를 등록하고 도메인 소유권 등 검증 요건을 확인한다.
- [ ] 브랜드 검증 신청·보완·승인을 완료한다.
- [ ] 승인 후 브랜딩을 게시하고 실제 Google 로그인 화면에서 이름 표시를 확인한다.

현재는 TODO 기록만 수행한다. Google 로그인 기능은 기존 설정으로 유지한다. 앱 이름 표시를 위한 Google 브랜드 검증과 Supabase 인증 URL 자체를 바꾸는 커스텀 도메인은 별도 작업이다.

참고: [Google OAuth 앱 브랜딩](https://support.google.com/cloud/answer/15549049?hl=en), [Supabase Google 로그인 브랜딩](https://supabase.com/docs/guides/auth/social-login/auth-google).

## 설정 확인 목록

- [x] Supabase 프로젝트 생성: 소유자 보고.
- [x] Google provider 설정 저장: 소유자 보고.
- [ ] 실제 리전·Security 옵션 확인.
- [ ] Google 테스트 사용자·로그인 범위 확인.
- [x] Supabase 개발 복귀 주소 등록: 소유자 보고. Windows loopback 주소 추가 확인.
- [ ] Google만 사용할 경우 다른 로그인 방식 비활성화 확인.
- [x] 앱 연결 정보 설정 및 SQL 실행: 소유자 보고. 환경변수 형식·원격 Google 활성화·비로그인 조회 차단 확인.
- [x] Windows 실제 Google 로그인·재실행 유지·로그아웃·재로그인과 기존 메모 보존: 소유자 보고.
- [ ] PC·웹 메모 데이터 동작과 실제 두 계정 접근 차단 검증.

이 목록은 현재 대화에서 확인된 상태를 기록한다. 대시보드 설정과 동작 검증 후 갱신한다.
