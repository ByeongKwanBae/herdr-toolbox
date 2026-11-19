# Space Organizer

Herdr App의 Spaces 사이드바를 확장하는 [Herdr Toolbox](../../README.md)의 첫 mod입니다.

**현재 상태: 그룹 관리·순서 통합·로컬/원격 폴더 선택과 자동 소속 구현, v0.0.1 미출시.**
개발 빌드 버전은 `0.0.1-dev.3`입니다. WSL의 폴더 탐색 → 생성 → 실제 터미널 작업 폴더와 그룹 소속을 확인했습니다. 배포 도구는 후속 작업입니다.

## 현재 기능

| 기능 | 상태 |
|---|---|
| 기본 목록, 선택, 이름 변경, 닫기 | Herdr 0.1.16 Spaces 포팅; 우클릭 Delete Space… → 기본 닫기 확인창 |
| 머신 상태, git 정보와 worktree 메뉴 | 그룹 메뉴에 기본 항목 통합; worktree 대화상자·작업은 Herdr 제공 |
| 머신별 그룹 | 생성·이름 변경·삭제, 같은 머신 소속 이동·해제, 접기·펼치기 |
| 그룹 표시 | 트리형: 머신 구분선 → 들여쓴 폴더 그룹 → 연결선 안의 Space; 개수·상태 표시, 연결이 끊기면 미확인 표시 |
| 저장 | space-organizer.groups / schema 1, 최신 상태 재조회, 알 수 없는 스키마 보존 |
| 실제 순서 | 그룹과 worktree를 한 계획으로 정렬, 1초 간격·최초 포함 3회 제한, 실패 후 명시적 재시도 |
| Spaces 헤더 `+` | 선택된 머신과 관계없이 로컬 폴더 선택 |
| 로컬 머신 헤더 `+`와 로컬 빈 목록 생성 행 | 로컬 폴더 선택 |
| 로컬 그룹 헤더 `+` | 폴더 선택 후 확인한 새 Space만 해당 그룹에 자동 소속 |
| 원격 머신·원격 그룹 헤더 `+`와 원격 빈 목록 생성 행 | 원격 폴더 탐색 팝업 → 선택한 폴더에서 새 Space 생성; 그룹에서 시작하면 자동 소속 |
| Add Folder | Linux·macOS 원격 팝업에서 현재 위치에 폴더 생성 후 그 폴더로 이동. 중복 이름은 덮어쓰지 않음 |
| 원격 OS | Linux·macOS는 POSIX 셸, Windows는 PowerShell; 실제 검증 범위는 아래 표 참고 |
| 탭 바 `+` | 기존 Herdr 동작 유지 |
| 취소·오류·중복 요청 | 취소 시 무호출, 요청 하나만 진행, 오류 후 재사용 |
| 자체 메뉴와 대화상자 | Space·머신·그룹 메뉴와 그룹 입력·삭제 확인 |
| 좁은 레일 | 그룹 접힘과 관계없이 실제 순서의 모든 번호 표시 |
| 드래그 그룹 이동 | 펼친 사이드바에서 로컬·원격 Space를 같은 머신의 그룹 헤더/구성원 위에 드롭; 빈·접힌 그룹 지원 |
| 드래그 소속 해제 | 드래그 중 같은 머신에 표시되는 해제 영역 또는 그룹 없는 Space 위에 드롭 |
| 임의 드래그 재정렬 | 미제공; 소속 변경 후 그룹·worktree 정렬 계획 적용 |

로컬 경로는 `space.new`의 `{ folder, machine: "" }`, 원격 경로는 `{ folder, machine: 선택한_머신 }`에 그대로 전달합니다.
이름은 Herdr 자동 이름을 사용합니다. 명령 반환만으로 성공 처리하지 않고, 명령 직전의 ID 집합과
비교해 같은 머신·같은 폴더의 새 Space를 250ms 간격으로 최대 5초 동안 관찰합니다.
시간 초과나 복수 후보에서는 생성 명령을 반복하지 않습니다. 먼저 목록과 앱 알림을 확인하세요.

설치·업데이트·복원과 배포 검증은 v0.0.1의 남은 범위입니다.
기존 터미널의 폴더 복원과 PC 간 그룹 동기화는 후속 버전 범위입니다.

### 그룹 사용법

머신 헤더 아래에 폴더 아이콘이 붙은 그룹을 들여쓰고, 구성원은 세로 연결선 옆에 표시합니다.
그룹 없는 Space는 기본 들여쓰기를 사용하며 worktree는 그룹 안에서 한 단계 더 들어갑니다.
긴 그룹 이름은 말줄임 처리하며 헤더에 마우스를 올리면 전체 이름·Space 수·상태를 확인할 수 있습니다.

1. Space를 우클릭해 New group and move…로 그룹을 만들거나 Move to group…으로 같은 머신의 그룹을 선택합니다.
2. 빈 그룹은 Spaces 헤더 또는 머신 헤더의 `⋯` → New group…으로 만듭니다.
3. 그룹 헤더 클릭으로 접고, 우클릭으로 이름을 바꾸거나 삭제합니다. 삭제는 Space와 터미널을 유지합니다.
4. 그룹의 `+`로 폴더를 선택하면 확인된 새 Space만 그 그룹에 들어갑니다. 로컬은 시스템 선택창, 원격은 원격 탐색 팝업을 사용합니다.
5. 그룹 이름은 NFC 정규화·앞뒤 공백 제거 후 1–60개 코드 포인트이며 제어 문자와 같은 머신의 중복 이름은 거부합니다.
6. Space를 5px 이상 드래그한 뒤 같은 머신의 그룹 헤더나 구성원 위에 놓아 소속을 바꿉니다. 접힌 그룹은 접힘을 유지하며 개수가 갱신됩니다.
7. 드래그 중 나타나는 Drop here to remove from group 영역이나 그룹 없는 Space 위에 놓으면 소속이 해제됩니다. 사이드바 밖으로 나가면 드래그가 취소됩니다.

드롭 직전에 Space·그룹 존재와 머신 ready 상태를 다시 확인합니다. 다른 머신에는 넣을 수 없고,
로딩·연결 끊김 상태에서는 이동하지 않습니다. 좁은 번호 레일에서는 우클릭 Move to group…을 사용합니다.
스크롤 경계에서 자동 스크롤은 제공하지 않습니다. Space와 대상이 보이도록 목록을 스크롤한 뒤 드래그하세요.

Space를 닫을 때는 우클릭 Delete Space…를 사용합니다. Herdr의 기본 닫기 확인을 거치며
해당 Space와 터미널을 종료합니다. 폴더·Git worktree 삭제는 별도의 Remove worktree 동작입니다.

### 원격 폴더 선택

1. 연결된 원격 머신 또는 그 머신의 그룹 헤더에서 `+`를 누릅니다.
2. 폴더를 클릭해 들어가거나 경로 입력 후 Go/Enter로 이동합니다. Home, Up, Root 또는 Drives / roots, Refresh를 사용할 수 있습니다.
3. 현재 경로를 확인하고 Create Space here를 누르면 그 폴더에서 새 Space와 터미널이 열립니다. 그룹 헤더에서 시작했다면 해당 그룹에 자동 소속됩니다.
4. 취소하면 Space를 만들지 않습니다. 경로를 수정한 뒤에는 Go로 조회를 완료해야 생성할 수 있습니다.
5. Linux·macOS에서 새 폴더가 필요하면 Add Folder → 이름 입력 → Create Folder/Enter를 사용합니다. 생성한 폴더로 이동한 뒤 Create Space here로 Space를 엽니다. 폴더 생성만으로 Space를 만들지는 않습니다.

숨김 폴더와 디렉터리 심볼릭 링크를 탐색하며, Windows는 드라이브·UNC 경로를 지원합니다.
POSIX 심볼릭 링크는 실제 대상 경로로 이동하며, 그 경로로 Space를 생성합니다.
목록은 한 번에 500개로 제한합니다. 다른 폴더는 경로를 직접 입력해 열 수 있습니다.
Add Folder는 현재 위치의 하위 폴더 이름 하나만 받습니다. `/`, `.`, `..`, 제어 문자를 거부하며, 이미 같은 이름이 있거나 쓰기 권한이 없으면 오류를 표시하고 입력을 보존합니다. 생성 중 중복 실행과 팝업 닫기는 막습니다. Windows 원격 팝업의 폴더 생성은 아직 제공하지 않습니다.
Linux·macOS에는 sh/uname, Windows에는 powershell.exe 또는 pwsh가 필요하며 추가 패키지를 설치하지 않습니다.
POSIX 경로는 별도 argv, Windows 경로는 UTF-16LE로 인코딩한 데이터로 전달해 따옴표·한글·셸 특수 문자를 코드로 해석하지 않습니다.
생성 직전에 폴더 존재·접근과 머신 상태를 재확인하며, 로딩·오류 상태에서는 생성하지 않습니다.
생성 전 확인은 하위 목록을 다시 열거하지 않습니다. 탐색 응답을 기다리는 동안 입력한 경로는 보존하며,
팝업 버튼과 폴더 행은 Tab으로 이동해 키보드로 실행할 수 있습니다. 생성 중에는 팝업 닫기를 막습니다.
POSIX 생성 후보는 대소문자를 구분하고 Windows는 구분하지 않습니다.

| 원격 OS 처리 | 확인 범위 |
|---|---|
| Linux / Ubuntu WSL | 실제 원격 팝업, 홈·하위 폴더 탐색, 취소, Space 생성, 그룹 자동 소속, 실제 터미널 cwd |
| Windows | 현재 Windows PC에서 실제 PowerShell 파일시스템 조회; 원격 머신 지정·생성 계약과 경로는 자동 테스트 |
| macOS | 공통 POSIX 처리와 Darwin 분기·경로·생성 계약 자동 테스트; 실제 macOS 연결은 미검증 |

실제 원격 Windows와 macOS 앱/코어에서 생성하는 전체 흐름은 추가 실기 검증이 필요합니다.

### 선택 경로 대신 홈 디렉터리로 열릴 때

Space의 `folder`와 `hc get <terminal> --json`의 시작 `cwd`가 선택 경로인데 `foreground.cwd`만 홈이라면, 원격 셸 초기화 파일의 `cd` 조건을 확인합니다.
실제 WSL 환경에서 `.bashrc`의 `/mnt/c/*` → `cd "$HOME"` 조건이 원인이었으며, 원본을 백업하고 그 조건에 `[[ -z "${HC_TERMINAL_ID:-}" ]]`을 추가해 Herdr 터미널은 선택 경로를 유지하도록 수정했습니다. 기존 터미널에는 명령을 보내지 않았습니다.
이는 해당 환경의 초기화 설정 수정이며 mod가 다른 머신의 셸 설정을 자동으로 바꾸지는 않습니다. 새 Space부터 적용됩니다.

순서 적용 중에는 실제 순서와 그룹 레이블을 표시합니다. 3회 안에 수렴하지 않으면 멈추며 헤더의
Ordering paused 또는 메뉴의 Retry Space ordering으로 재시도합니다. 접힌 그룹의 번호를 새로 매기지 않습니다.
머신 영역이 서로 섞이는 등 지원하지 않는 호스트 순서는 이동 명령을 보내지 않고 정렬을 중단합니다.
이 경우에도 실제 목록을 계속 표시합니다.
다른 경로에서 그룹 안의 Space를 선택하면 펼치며, 현재 Space가 든 그룹을 직접 접은 상태는 선택이 바뀔 때까지 유지합니다.

worktree는 같은 그룹 안에서만 부모 아래에 중첩합니다. New worktree는 기본 생성 동작을 유지하고
부모의 그룹을 자동 상속하지 않습니다. 원하면 생성 후 같은 그룹으로 옮기세요.

로딩·연결 끊김·사라진 머신의 소속을 지우지 않습니다. ready 상태의 두 관찰에서 1초 이상 계속
없었던 Space만 정리합니다. 알 수 없는 저장 스키마는 덮어쓰지 않으며 기본 목록을 계속 표시합니다.
그룹 편집은 하나의 앱 프로세스·사이드바를 지원합니다. 여러 프로세스의 동시 편집은 지원하지 않습니다.

## 로컬에서 사용하기

로컬 사용에는 ZIP이 필요하지 않습니다. 빌드한 mod 파일을 앱 홈의 mods/space-organizer/에 두고,
기존 레이아웃의 복제본에서 Spaces 블록의 content.mod만 space-organizer로 연결합니다.
파일 설치와 개인 레이아웃 연결이 끝난 PC에서는 다음 명령으로 사용할 수 있습니다.

```powershell
herdr-app do layout.switch --name space-organizer
```

Space를 우클릭해 New group and move…를 선택하면 첫 그룹을 만들 수 있습니다.
Ctrl+Shift+L로 다른 레이아웃으로 전환할 수 있으며 기존 레이아웃과 Space는 유지합니다.
코드 변경 반영과 처음 연결하는 절차는 아래 개발용 앱 연결 항목을 따릅니다.

공식 갤러리의 에이전트 설치 방식도 RECIPE와 파일을 읽고 mod 복사·레이아웃 연결·검사를 수행합니다.
이 저장소도 에이전트에게 같은 작업을 맡길 수 있습니다. 배포용 ZIP과 설치 스크립트는 별도 편의 기능이며
현재 로컬 빌드 사용의 선행 조건은 아닙니다.

## 개발 환경

| 항목 | 기준 |
|---|---|
| Node.js / npm | `24.22.3` / `11.19.1`; .node-version, package.json의 Volta 설정 |
| TypeScript / esbuild | `5.9.3` / `0.27.7`; package-lock.json |
| SDK / 검증 앱 | Windows 11, Herdr App `0.1.16` |
| 타입 검사 | strict; Node 타입은 테스트에만 포함 |
| 빌드 | ESM, ES2020; herdr, gpui-kit, gpui-base external |
| 테스트 | TypeScript 변환 후 Node.js 내장 node:test |

앱 코드는 DOM, Node API와 브라우저 타이머를 사용하지 않습니다. 비동기 작업과 대기는
Herdr의 `cx.spawn`과 `cx.sleep`을 사용합니다. SDK 자체 선언은 `skipLibCheck`로 검사하지 않지만,
앱 코드의 SDK 타입 검사와 캐시 해시 검증은 수행합니다.

Node.js 24를 준비한 뒤 저장소 루트에서 실행합니다.

```powershell
Set-Location mods/space-organizer
npm ci
npm run sdk:sync
npm run typecheck
npm test
npm run build
npm run check:app
```

이번 PC에서는 시스템 Node.js 20을 바꾸지 않고 저장소의 `.cache/tools/node-v24.22.3-win-x64/`에
공식 ZIP을 체크섬 검증 후 풀어 사용했습니다. 이 캐시는 Git에 포함되지 않습니다.
현재 작업 공간에서 같은 캐시를 사용하려면 모듈 루트에서 다음을 실행합니다.

```powershell
$toolboxNode = (Resolve-Path '../../.cache/tools/node-v24.22.3-win-x64').Path
$env:PATH = "$toolboxNode;$env:PATH"
node --version
npm --version
```

### SDK 준비

`sdk:sync`는 `HERDR_APP_HOME`, 없으면 사용자 홈의 `.config/herdr-app/`에서
herdr.d.ts와 gpui-kit.d.ts를 읽어 `.cache/herdr-sdk/`에 준비합니다.
`HERDR_APP_BIN`으로 실행 파일을 지정할 수도 있습니다. 기본값은 PATH의 herdr-app입니다.

앱 버전, SDK 두 파일과 기준 Spaces·menu·worktree 원본의 SHA-256이 sdk.lock.json과 일치해야 합니다.
캐시 누락이나 해시 불일치는 typecheck와 build를 실패시킵니다. SDK를 any로 대체하지 않습니다.
앱 버전을 올릴 때는 API와 기본 Spaces 변경을 검토하고 잠금을 명시적으로 갱신합니다.
SDK가 없는 CI에서 Node 테스트만 통과한 것을 타입 검사·앱 검증 성공으로 표시하면 안 됩니다.

### 개발용 앱 연결

최초 한 번만 기본 mod와 레이아웃을 복제합니다. 이미 같은 이름이 있으면 덮어쓰지 않습니다.
레이아웃 복제 명령은 복제한 레이아웃으로 전환합니다.

```powershell
herdr-app do mod.clone --name spaces --as space-organizer
herdr-app do layout.clone --name main --as space-organizer-dev
```

개발 레이아웃의 Spaces 블록 `content.mod` 한 곳만 `space-organizer`로 바꿉니다.
원본 spaces와 기본·업무 레이아웃 파일은 편집하지 않습니다.
모듈 루트에서 복제 mod 경로를 명시하고 빌드를 반영합니다.

```powershell
$appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $env:USERPROFILE '.config/herdr-app' }
$env:HERDR_DEV_MOD_DIR = Join-Path $appHome 'mods/space-organizer'
npm run dev -- --once
herdr-app status
# 이후 변경 감시:
npm run dev
```

dev는 대상 이름, 복제 메타데이터와 경로의 심볼릭 링크·junction을 검사합니다.
SDK 검증, 타입 검사와 빌드가 성공한 결과만 복제 mod에 반영하며 실행 파일을 마지막에 교체합니다.
실패한 빌드는 설치 위치에 복사하지 않습니다. 배포용 설치·업데이트 도구는 아직 없습니다.

checking()이 참이면 상태 쓰기, Space 명령, 폴더 선택과 외부 프로세스 실행을 막습니다.
check:app는 사이드바와 props.view=menu, props.view=group, props.view=folders를 각각 검사합니다.
Herdr 0.1.16이 실패 문구와 함께 종료 코드 0을 반환하는 경우도 스크립트가 실패로 처리합니다.
초기 렌더 검사는 실제 클릭과 비동기 검증을 대신하지 않습니다.

## 검증과 남은 범위

기반 기능은 dev.1에서, 원격 탐색은 2026-11-19에 Windows 11 / Herdr 0.1.16 / 개발 빌드 0.0.1-dev.2에서 확인했습니다.
dev.3에서는 실제 WSL의 `/mnt/c` 임시 폴더 생성과 새 기본 Bash의 실제 cwd를 추가 확인했습니다. 검증 Space를 focus=false로 열고 정리한 뒤 기존 Space 순서와 선택을 대조했습니다.

| 검사 | 결과 |
|---|---|
| npm ci, sdk:sync, typecheck | 고정 의존성·SDK 설치와 strict 타입 검사 |
| npm test | 85개 통과, 실패·건너뜀 0개; 현재 Windows에서 실제 PowerShell 파일시스템 테스트 포함 |
| npm run build | ESM 빌드와 런타임 import 검사 성공 |
| npm run check:app | 사이드바·menu·group·folders 초기 렌더 4종 통과 |
| npm run dev -- --once | 개발용 복제 mod에 반영 성공 |
| 기존 SDK 누락·변조 / 잘못된 개발 대상 검증 | bootstrap에서 실패 처리 확인, 절차 유지 |

실제 앱에서는 다음을 확인했습니다.

- 그룹 생성·이름 변경·같은 머신 내 이동·삭제, 빈 이름 거부와 빈 그룹 보존.
- 그룹에서 한글·공백 폴더를 선택한 새 Space의 자동 소속과 실제 순서 반영.
- 현재 Space가 든 그룹의 수동 접힘 유지, 다른 Space 선택 시 펼침, 접힌 그룹을 포함한 레일 번호.
- mod 재로딩·레이아웃 재진입 후 그룹·소속·접힘 보존.
- 로컬 Space가 선택된 상태의 원격 머신 헤더 `+`: 원격 탐색 팝업과 취소 시 미생성.
- 원격 그룹 `+`에서 한글·공백·따옴표·$가 든 폴더를 탐색 → 중복 클릭에도 Space 하나 생성 → 해당 그룹 소속과 실제 터미널 cwd 일치.
- 로컬 Windows와 연결된 Linux 머신 각각에서 New worktree → 해당 Space 닫기 → Open worktree → Remove worktree.
- 실제 Git 체크아웃·Space 생성, 기존 체크아웃 재개방, 삭제 후 경로·Git 등록·Space 제거와 브랜치 보존.
- 같은 그룹의 부모와 worktree가 실제 연속 순서로 수렴하고 다른 그룹에서는 독립 표시.
- 로컬 Space의 빈·접힌 그룹 드롭과 소속 해제, 원격 WSL Space의 그룹 드롭·소속 해제·재소속.
- 트리형의 로컬·WSL 폴더 그룹과 연결선 표시, 그룹 접기·펼치기, 일회용 Space의 헤더 드롭과 구성원 행에서 소속 해제.
- 로컬·WSL 각각의 일회용 Space를 Delete Space… → 기본 닫기 확인으로 종료.
- 검증 자원 정리 후 기존 Space ID 집합·상대 순서·업무 레이아웃·선택 복원, 앱 오류 없음.

이름 경계·프로토타입 키, 잘못된 스키마 보존, 오프라인·로딩 중 정리 보류, 오래된 메뉴 상태,
순서 충돌 3회 제한, 복수·늦은 생성 후보와 오류 후 복구는 Node 경계 테스트로 검증했습니다.
실제 네트워크 단절이나 오류 주입 시험을 모두 수행한 것은 아닙니다.
100개 Space·20개 그룹의 순수 로직 측정과 상세 실행 기록·원시 증빙은 Git 제외 artifacts/에 보관합니다.

남은 출시 검증은 실제 앱 프로세스 재시작, 원격 연결 끊김·재연결, UNC 경로,
100개 Space·20개 그룹의 실제 UI p95, 장시간 감시, 설치·업데이트·복원과 배포 패키지입니다.
재시작을 대신해 mod 재로딩과 View 재생성까지만 실제 확인했습니다.
다른 화면에서 같은 폴더를 동시에 생성하면 요청과 새 ID의 정확한 연결은 보장하지 않습니다.
최신 배포 버전은 **미출시**입니다.

## 문서와 원본

- [변경 이력](CHANGE.md)
- [개발 구조와 후속 계약](RECIPE.md)
- [모던 코드 기준 점검과 Sonnet/high 최종 리뷰](reviews/FINAL_REVIEW.md)
- [원본 고지](THIRD_PARTY_NOTICES.md), [라이선스](LICENSE)
- [브랜치와 릴리스 규칙](../../CONTRIBUTING.md)

로컬 PRD.md와 SPEC.md, SDK 캐시, 의존성, 빌드 결과와 검증 아티팩트는 Git에서 제외합니다.
공유 문서와 잠금 파일에는 사용자 절대 경로나 실제 Space ID를 기록하지 않습니다.
