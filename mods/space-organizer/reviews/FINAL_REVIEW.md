# Space Organizer 최종 코드 리뷰

## 1. 리뷰 요약

- 대상: `feat/space-organizer/remote-folder-picker`, 기본 골격 이후 그룹·트리·드래그·로컬/원격 폴더·worktree 연동 전체와 최종 보완 변경.
- 검토일: 2026-11-19. 개발 버전 `0.0.1-dev.2`, Herdr `0.1.16` 고정 SDK.
- 변경 의도: 기존 동작을 유지하면서 입력·비동기·플랫폼·키보드 접근 경계를 보완한다.
- 종합 판정: Sonnet/high 초기 리뷰와 두 차례 보완 재검토 완료. 최종 **Approve with comments · Push 가능**, 확정 Blocker/Major 및 새 회귀 없음. 비차단 후속 항목과 실기 검증 범위는 아래에 남긴다.
- 초기 독립 리뷰: Blocker 0 · Major 1(확인 필요) · Minor 8 · Nit 6. 확정 Blocker/Major는 없었다.

실제 Claude Code CLI를 별도 읽기 전용 프로세스로 실행했다. 요청 옵션은 `--model sonnet --effort high`이며 초기 실행 메타데이터에서 실제 모델 `claude-sonnet-5-5`와 `output_config.effort=high`를 확인했다. 리뷰어에는 Read/Glob/Grep만 허용했고, 코드 수정·셸·MCP·실제 앱 조작은 허용하지 않았다. Orca worker는 `no_active_sender_terminal`로 생성되지 않아 실제 Claude CLI 독립 프로세스로 진행했다. 다른 모델의 리뷰로 대체하지 않았다. 원본 보고서·실행 메타데이터는 Git 제외 `artifacts/final-review/`에 보관한다.

## 2. 모던 코드 기준 점검

이 프로젝트는 Herdr의 네이티브 GPUI mod다. 모던 웹의 설계·검증 원칙을 적용하되, 브라우저 DOM이나 React API를 요구하지 않고 실제 SDK 계약과 ES2020 런타임을 기준으로 평가했다.

| 기준 | 확인 결과 |
|---|---|
| 언어·모듈 | TypeScript strict, ESM, 고정 SDK·의존성 잠금. unused 선언·인자와 switch fallthrough 검사 추가 |
| 책임 분리 | 순수 core 로직, 주입 가능한 host 어댑터, 네이티브 UI 분리 |
| 데이터 경계 | unknown 검증, 버전 스키마 거부 시 기존 데이터 보존, 불변 그룹 갱신, own-property 소속 처리 |
| 비동기·오류 | 최신 탐색 응답만 적용, 닫힌 View 가드, 생성 중복 방지, 생성 관찰 시간·정렬 재시도 제한 |
| 입력·프로세스 | POSIX 별도 argv, PowerShell 인코딩 데이터, LiteralPath. 경로를 명령문으로 삽입하지 않음 |
| 접근성 | SDK Button의 키보드 활성화·Tab·disabled·접근성 이름, 메뉴 방향키/Enter 유지 및 네이티브 역할 부여 |
| 성능 | 목록 500개 제한, 생성 전 목록 재열거 제거, 입력 중 불필요한 전체 갱신 감소, 관찰 스냅샷 재사용 |
| 검증 가능성 | 경계·경합·취소·오류 회복 테스트, 실제 OS 프로세스 테스트, 번들 import와 inert 앱 초기 검사 |

접근성 API를 적용한 사실과 실제 스크린리더·키보드 사용자 검증은 구분한다. 전체 접근성 적합성 인증을 의미하지 않는다.

## 3. 주요 지적과 수정

### M1 — Major · 확인 필요: 머신 순서가 섞인 호스트 스냅샷에서 정렬 예외

- 발현 조건: 호스트가 `[local A, remote R, local B]`와 같이 동일 머신의 Space를 비연속으로 반환한다. 고정 SDK는 머신 블록 불변식을 명시하지 않아 가능 여부는 외부 계약 확인이 필요하다.
- 원인: `desiredOrder()`가 머신별로 모은 목표를 만들고 `movePlan()`이 머신 경계 위반으로 예외를 던지면, 이를 호출하는 사이드바 관찰이 중단될 수 있었다.
- 조치: [ordering.ts](../src/core/ordering.ts:59)의 synchronizer에서 계획 예외를 잡아 이동 명령 0개·정렬 중단·한 번의 경고로 처리한다. 사이드바는 실제 목록을 계속 표시하며 명시적인 Retry 또는 새 소속 변경으로 복구한다.
- 판단: 머신 사이 이동을 추정해서 실행하지 않는다. 비연속 스냅샷·잘못된 순열·경고 중복 방지·reset 후 복구 테스트를 추가했다.

## 4. 부가 지적 처리

| ID | 초기 심각도·확신도 | 위치 | 처리 |
|---|---|---|---|
| m1 | Minor · 확정 | `src/ui/folders.ts:106`, `overlay.ts:148`, `sidebar.ts:586` | 버튼·폴더 행에 SDK Button, Tab, disabled, 접근성 이름 적용. 메뉴의 기존 키보드 처리와 역할 유지 |
| m2 | Minor · 확정 | `src/core/folders.ts:72`, `src/ui/folders.ts:59` | 로딩 중 추가 탐색 금지, 대기 중 주소 편집 보존, dirty 상태 변경 시에만 부모 갱신 |
| m3 | Minor · 확정 | `src/ui/sidebar.ts:208` | tick 내 Spaces/panes 재사용, 실제 reveal/prune 쓰기 이후만 상태 재조회, 행 위치 중복 계산 제거 |
| m4 | Minor · 확인 필요 | `src/host/remote-directory.ts:7`, `:64` | 생성 전 경로 검증을 하위 열거와 분리. 매우 큰 POSIX 디렉터리의 첫 glob 비용은 후속 측정 대상 |
| m5 | Minor · 확인 필요 | `src/host/remote-directory.ts:50` | Console.OutputEncoding 변경 제거, UTF-8 바이트를 표준 출력 스트림에 직접 기록. 실제 Windows 프로세스로 검증 |
| m6 | Minor · 확인 필요 | `src/ui/sidebar.ts:194` | 원격 탐색을 modal로 열고 생성 중 Cancel/Escape 차단 유지 |
| m7 | Minor · 확인 필요 | `src/host/checkout.ts:4` | git-dir/common-dir 비교로 submodule·별도 Git 디렉터리와 linked worktree 구분. 확인 실패 시 Remove를 보수적으로 숨김 |
| m8 | Minor · 확정 | `tests/native-directory.test.ts:11`, `tests/ordering.test.ts` | 실제 네이티브 프로세스·정렬 예외·주소 편집·경로 사전 확인·체크아웃 분류 테스트 보강. 전체 앱 비동기 자동화는 별도 범위 |
| n1 | Nit | `src/host/herdr-adapter.ts:19` | hex 색상을 3/4/6/8자리로 제한 |
| n2 | Nit | `src/ui/sidebar.ts:117` | 실제 호스트 OS로 로컬 경로 비교. OS 창이 없는 checking 환경에서는 생성이 금지된 대체값만 사용 |
| n3 | Nit | `src/main.ts:19`, `src/ui/sidebar.ts:319` | 종료 시 감시 취소·정렬 무효화·closed 가드·대기 명령 뒤 context 확인. nextCommand 자체 취소는 호스트 태스크 수명 계약에 의존 |
| n4 | Nit | `scripts/dev.mjs:44` | 개발 감시의 전체 루트 재귀·debounce 부재는 개발 성능 후속 과제. 런타임 동작과 분리 |
| n5 | Nit | `README.md` | POSIX 심볼릭 링크 탐색 시 실제 대상 경로로 생성함을 명시 |
| n6 | Nit | `src/core/model.ts:12` | 그룹 수 상한·bidi/zero-width 정책은 제품 제한 합의 후 적용. 임의 제한으로 정상 Unicode 이름·기존 스키마를 손상시키지 않음 |

### 재검토에서 추가한 보완

- R1 · Minor · 확인 필요: 일시적인 비연속 머신 순서에서도 정렬 중단을 수동 reset까지 유지한다. 안전한 이동 계약이 없으므로 자동 재개·머신 사이 재배치를 추가하지 않았다. 지원 불가 순서의 배너가 그룹이 없어도 나타날 수 있는 UX 한계를 코디네이터가 비차단 후속 항목으로 분류했다.
- R2 · Minor · 확인 필요: PowerShell 전체를 try/catch로 감싸 오류도 UTF-8 평문으로 전달한다. 실제 네이티브 테스트가 모듈 로드 progress의 CLIXML 출력을 발견해 progress도 차단했다. 없는 폴더·파일 오류에 XML이 없다는 단언과 비정상 JSON의 일반 오류 변환 테스트를 추가했다.
- R3 · Minor · 확인 필요: disabled Button의 이벤트 처리에만 의존하지 않도록 그룹·머신 생성 버튼에 별도 전파 차단 wrapper를 추가했다. 그룹 wrapper는 mouse down/up도 차단한다. 실제 클릭 전파 실기는 남아 있다.
- R4 · Minor · 확정: Git 세 번째 조회만 실패하면 worktree를 main으로 오인해 순서를 움직일 수 있었다. 분류 결과를 true/false/unknown(null)으로 나누고, 사이드바는 unknown일 때 이전 정보를 유지한다. 메뉴에서는 Remove를 계속 숨긴다.

마지막 Sonnet/high 확인은 R2·R4 해소, R3 소스상 해소와 실제 입력 미검증을 구분했으며 Push 가능으로 판정했다. 추가 Nit로, 처음 보는 체크아웃의 세 번째 Git 조회만 실패하면 첫 저장소 표시가 활성 창의 최대 약 60초 fallback까지 늦어질 수 있음을 기록했다. 기존 분류를 가진 체크아웃은 그 값을 보존한다.

재검토의 Nit에는 전체 사이드바 오케스트레이션 자동 테스트 부재, 일부 헤더·행의 포인터 중심 조작, Windows 권한 변경과 InputState 이벤트 시점의 실기 확인 등이 남았다. 이러한 범위를 전체 접근성·전체 UI 자동화 완료로 표기하지 않는다.

## 5. 실행한 검증

검증 명령은 코디네이터가 실행했다. 독립 리뷰어가 실행하지 않은 명령을 리뷰어의 실측으로 표기하지 않는다.

| 명령 | 결과 |
|---|---|
| `npm run typecheck` | SDK 해시·버전 일치, strict 및 추가 unused/fallthrough 검사 통과 |
| `npm test` | 81개 통과, 실패·건너뜀 0개 |
| `npm run build` | ESM 빌드·호스트 import 검사 통과 |
| `npm run check:app` | sidebar/menu/group/folders 4종 초기 렌더 통과 |

새 네이티브 테스트는 현재 Windows의 PowerShell을 별도 비대화형 프로세스로 실행했다. 한글·이모지·따옴표·공백·달러·백틱·대괄호, 디렉터리 junction, 일반 파일 제외, 빈 폴더, 홈/루트, 503개 중 500개 표시와 목록을 재열거하지 않는 경로 검증을 확인했다. 생성한 임시 fixture만 경로를 확인해 정리했다. 기존 Herdr 터미널에 키를 입력하거나 원격 Space를 새로 생성하는 검증은 이번 리뷰에서 수행하지 않았다.

Linux/macOS 실행 시에는 동일 테스트가 실제 sh 스크립트를 실행하도록 작성했지만, 이번 실행 환경은 Windows다. 이전 실제 Ubuntu WSL 팝업·생성·그룹·cwd 검증과 사용자의 확인은 [README](../README.md)에 따로 기록한다.

## 6. 남은 범위와 최종 결론

원격 Windows/macOS의 전체 앱 동작, UNC, 실제 연결 끊김·재연결, 장시간 감시·대규모 UI 지연, 앱 완전 재시작과 설치·업데이트·복원은 출시 전 추가 검증 범위다. 매우 큰 POSIX 디렉터리는 첫 목록의 glob 확장 비용 때문에 시간 초과가 날 수 있으며 오류 시 생성을 차단한다. 생성 전 확인에서 이 목록을 다시 열거하지는 않는다.

소스·추가 파일·문서와 검증 결과를 같은 기능 브랜치에 커밋해 원격으로 push할 수 있다. 원격 반영은 릴리스·main 병합·태그 발행을 의미하지 않는다.
