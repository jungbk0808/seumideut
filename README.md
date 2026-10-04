# 스미듯

스미듯: 떠오른 생각을 언제 어디서나 가볍게 남기는 기록 공간

현재 구현된 앱은 Tauri + React + TypeScript 기반 로컬 우선 데스크톱 앱입니다. 개정 MVP에는 DB 연동과 독립 웹 앱을 추가하며, 통합 검증 후 7일 실사용을 시작합니다. 웹 접속 범위와 DB 방식은 결정 대기 중입니다.

> 스쳐 지나갈 생각들이 머무는 공간.

위젯 화면은 로고와 브랜드명을 표시하지 않고 메모 작성에 집중합니다.

## 구조

```text
apps/
  desktop/     Tauri + React + TypeScript 데스크톱 앱
docs/          개발 운영 문서
idea2planning/ 기획 산출물
```

## 개발 운영 문서

- 브랜치/커밋 규칙: `docs/git-workflow.md` (사람 작업과 Codex 작업의 브랜치 prefix 구분 포함)
- 문서 인덱스: `docs/README.md`

다른 세션에서 Git 작업을 시작할 때는 루트 `AGENTS.md`와 함께 `docs/git-workflow.md`를 확인합니다. Codex가 새 작업을 맡을 때는 작업 전용 `codex/<type>/<short-topic>` 브랜치를 먼저 만드는 규칙도 이 문서에 포함되어 있습니다.

## 개발 환경 준비

Windows 기준입니다. 브라우저에서 화면만 확인한다면 Node.js만 있으면 되고, Tauri 데스크톱 창으로 실행하려면 Rust와 C++ 빌드 도구도 필요합니다.

1. Node.js 설치
2. Visual Studio Build Tools 설치 (Tauri 데스크톱 빌드용)
   ```bash
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```

   - 설치 프로그램에서 직접 고른다면 "C++를 사용한 데스크톱 개발" 워크로드를 선택합니다.
   - 이미 Visual Studio가 설치되어 있다면 건너뜁니다.
   - 설치 후 터미널이나 VS Code를 완전히 닫았다가 다시 실행합니다.
3. Rust 설치 (Tauri 데스크톱 빌드용)

   ```bash
   winget install Rustlang.Rustup
   ```

   `winget`을 쓸 수 없으면 [rustup.rs](https://rustup.rs)에서 `rustup-init.exe`를 받아 기본값(MSVC)으로 설치합니다. 설치 후 `cargo --version`이 나오는지 확인합니다.

   설치 직후에는 PATH가 반영되지 않아 `cargo`를 찾지 못할 수 있습니다. 터미널이나 VS Code를 완전히 닫았다가 다시 실행하세요.
4. 의존성 설치

   ```bash
   npm --prefix apps/desktop install
   ```

`tauri` 명령을 찾을 수 없다는 오류는 4번 의존성 설치를 하지 않았을 때, `cargo metadata ... program not found` 오류는 Rust가 없거나 PATH가 반영되지 않았을 때, `linker link.exe not found` 오류는 2번 Build Tools가 없을 때 나옵니다. 첫 Tauri 빌드는 Rust 크레이트를 내려받고 컴파일하느라 몇 분 걸립니다.

## 개발 명령

```bash
npm --prefix apps/desktop install
npm run dev:desktop
npm run desktop:tauri:dev
npm run desktop:tauri:info
npm test
npm run build
```

루트 스크립트는 `npm --prefix apps/desktop ...`로 데스크톱 앱 명령을 위임합니다. 의존성 설치와 `node_modules`는 각 앱 폴더 안에서 관리합니다.

```bash
cd apps/desktop
npm install
npm run dev
npm run tauri:dev
```

`npm run dev:desktop`은 브라우저에서 프론트엔드를 확인할 때 사용하고, `npm run desktop:tauri:dev`는 Tauri 데스크톱 창으로 실행할 때 사용합니다. 데스크톱 앱 개발 서버는 `http://127.0.0.1:1420`을 사용합니다.

저장소 Rust 테스트는 `apps/desktop/src-tauri`에서 `cargo test --locked`로 실행합니다. 실제 Windows 창 확인과 7일 사용 기록은 `docs/mvp-qa-checklist.md`를 따릅니다.

## 디자인

- Figma: [Local-first Memo App MVP Design](https://www.figma.com/design/Qdw5rvoIKeMyKIhGGLCqky)
- 기준 페이지: `Editable v2`
- 주요 프레임:
  - `Screen / Widget Quick Memo - Editable`
  - `Screen / Full Memo Management - Editable`
  - `State / Empty - Editable`
  - `State / Delete Confirmation - Editable`
- 주요 컴포넌트:
  - `Memo v2/Button/Text`
  - `Memo v2/Button/Danger`
  - `Memo v2/Icon Button/Pin`
  - `Memo v2/Icon Button/Plus`
  - `Memo v2/Icon Button/Close`
  - `Memo v2/List Item`

참고: `Memo v2/Icon Button/Pin`은 `Pinned=false` / `Pinned=true` variant property를 가진 컴포넌트 세트입니다. 비고정 상태는 대각선이 그어진 빈 핀, 고정 상태는 세워진 채워진 핀을 사용합니다.
위젯 헤더 액션은 `Pin / Plus / Close` 순서이며, `Close`는 메모 삭제가 아니라 창처럼 보이는 위젯을 닫는 액션입니다.

## 현재 구현

- 위젯형 빠른 메모 기본 화면
- Figma 화면이 Tauri 창 자체가 되는 프레임리스 창
- 커스텀 닫기 버튼
- 제목 입력
- 본문 입력
- 본문 기준 실시간 글자수 카운터
- 공백 포함/공백 제외 카운트 표시
