# Git Workflow Rules

이 문서는 이 저장소의 브랜치 규칙과 커밋 메시지 규칙의 기준입니다.

위치: `docs/git-workflow.md`

다른 세션이 Git 작업을 시작할 때는 루트 `AGENTS.md`를 읽은 뒤 이 문서를 확인하세요.

## 기본 원칙

- 작은 단위로 작업하고, 한 커밋에는 하나의 논리적 변경만 담습니다.
- MVP 범위와 관련 없는 리팩터링, 포맷 변경, 의존성 변경은 기능 커밋에 섞지 않습니다.
- 사용자나 다른 세션이 만든 변경을 되돌리지 않습니다.
- 커밋 전에는 `git diff`로 의도한 변경만 포함됐는지 확인합니다.
- 기능 동작에 영향을 주는 변경은 가능한 범위에서 빌드 또는 테스트 결과를 남깁니다.

## 브랜치 규칙

브랜치 이름은 작업 주체에 따라 아래 형식을 사용합니다.

사람이 직접 만드는 브랜치:

```text
<type>/<short-topic>
```

Codex 세션이 만드는 브랜치:

```text
codex/<type>/<short-topic>
```

`codex/` prefix는 자동화 세션이 만든 작업임을 구분하기 위한 표식입니다. 사람이 직접 작업할 때는 `codex/`를 붙이지 않는 것을 기본으로 합니다.

`type`은 아래 중 하나를 우선 사용합니다.

| type | 사용 시점 |
|---|---|
| `feat` | 새 기능 추가 |
| `fix` | 버그 수정 |
| `docs` | 문서만 수정 |
| `refactor` | 동작 변화 없는 구조 개선 |
| `test` | 테스트 추가 또는 수정 |
| `chore` | 설정, 빌드, 의존성 등 보조 작업 |

이름 규칙:

- 사람이 직접 작업하면 `feat/...`, `fix/...`, `docs/...`처럼 시작합니다.
- Codex 세션이 작업하면 `codex/feat/...`, `codex/fix/...`, `codex/docs/...`처럼 시작합니다.
- 소문자와 kebab-case를 사용합니다.
- 가능하면 백로그 TASK ID나 핵심 도메인을 포함합니다.
- 너무 긴 설명은 피하고, 3~6개 단어 안에서 의미가 드러나게 씁니다.

사람 작업 예시:

```text
feat/task-006-local-storage
feat/autosave-debounce
fix/character-count-whitespace
docs/git-workflow-rules
refactor/note-editor-state
```

Codex 작업 예시:

```text
codex/feat/task-006-local-storage
codex/feat/autosave-debounce
codex/fix/character-count-whitespace
codex/docs/git-workflow-rules
codex/refactor/note-editor-state
```

브랜치 선택 기준:

- 사람이 직접 이어서 작업하고 관리할 브랜치는 `codex/` 없이 만듭니다.
- Codex에게 독립 작업을 맡기거나 세션별 작업 흔적을 분리하고 싶으면 `codex/`를 붙입니다.
- 이미 사람이 만든 브랜치에서 Codex가 보조 작업을 하는 경우에는 현재 브랜치 이름을 유지합니다.
- 장기 작업 브랜치는 작업자가 누구인지보다 기능 단위가 잘 보이는 이름을 우선합니다.

## 커밋 메시지 규칙

커밋 메시지는 Conventional Commits 형식을 따릅니다.

```text
<type>(<scope>): <summary>
```

예시:

```text
feat(storage): 로컬 메모 저장소 추가
fix(counter): 공백 제외 글자수 계산 수정
docs(workflow): 브랜치와 커밋 규칙 추가
```

`type`은 브랜치 규칙의 type과 동일하게 사용합니다.
`scope`는 변경 영역을 나타내는 짧은 영어 식별자로 유지합니다.

권장 `scope`:

| scope | 대상 |
|---|---|
| `desktop` | `apps/desktop` 앱 전반 |
| `tauri` | Tauri 설정 또는 Rust 쪽 변경 |
| `storage` | 로컬 저장소, 데이터 읽기/쓰기 |
| `autosave` | 자동 저장 흐름 |
| `counter` | 글자수 계산 |
| `notes` | 메모 생성/수정/삭제/목록 |
| `ui` | 화면, 스타일, 컴포넌트 |
| `docs` | 일반 문서 |
| `workflow` | Git, 협업, 운영 규칙 |
| `planning` | `idea2planning` 산출물 |

요약 작성 규칙:

- `type`과 `scope`는 영어 식별자를 사용합니다.
- `summary`는 한국어로 작성합니다.
- 커밋 본문도 필요한 경우 한국어로 작성합니다.
- summary 끝에 마침표를 붙이지 않습니다.
- 무엇이 바뀌었는지 50자 안팎으로 적습니다.
- `수정`, `작업`, `wip`처럼 의미가 흐린 표현은 피합니다.

## 커밋 본문과 푸터

간단한 변경은 제목 한 줄만 사용해도 됩니다.

맥락이 필요한 변경은 본문에 이유와 검증을 짧게 남깁니다.

```text
feat(storage): 로컬 메모 저장소 추가

향후 동기화와 마이그레이션을 고려해 schemaVersion을 포함한 메모 저장 구조를 추가한다.

Refs: TASK-006
Test: npm run build
```

권장 푸터:

- `Refs: TASK-006`
- `Test: npm run build`
- `Test: npm --prefix apps/desktop run build`
- `Test: not run (docs only)`

## 커밋 전 체크리스트

- `git status --short`로 변경 파일을 확인합니다.
- `git diff`로 의도하지 않은 수정이 섞이지 않았는지 확인합니다.
- 문서만 바꾼 경우 `Test: not run (docs only)`를 남길 수 있습니다.
- 코드 변경이 있으면 최소 `npm run build` 또는 영향 범위에 맞는 테스트를 실행합니다.
- generated file, lockfile, 빌드 산출물이 포함될 때는 왜 필요한지 확인합니다.

## Pull Request 또는 작업 공유 메모

PR이나 세션 마무리 메시지에는 아래 내용을 짧게 남깁니다.

- 변경 요약
- 검증한 명령
- 남은 리스크 또는 후속 작업
- 관련 백로그 TASK ID
