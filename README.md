# Memo App

로컬 우선 메모 앱 MVP 모노레포입니다. 현재 첫 구현 대상은 Tauri + React + TypeScript 기반 데스크톱 앱입니다.

## 구조

```text
apps/
  desktop/     Tauri + React + TypeScript 데스크톱 앱
idea2planning/ 기획 산출물
```

## 개발 명령

```bash
npm --prefix apps/desktop install
npm run dev:desktop
npm run desktop:tauri:dev
npm run desktop:tauri:info
```

루트 스크립트는 `npm --prefix apps/desktop ...`로 데스크톱 앱 명령을 위임합니다. 의존성 설치와 `node_modules`는 각 앱 폴더 안에서 관리합니다.

```bash
cd apps/desktop
npm install
npm run dev
npm run tauri:dev
```

`npm run dev:desktop`은 브라우저에서 프론트엔드를 확인할 때 사용하고, `npm run desktop:tauri:dev`는 Tauri 데스크톱 창으로 실행할 때 사용합니다. 데스크톱 앱 개발 서버는 `http://127.0.0.1:1420`을 사용합니다.

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
