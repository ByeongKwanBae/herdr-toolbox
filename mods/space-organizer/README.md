# Space Organizer

Herdr App의 Spaces 사이드바에서 작업 공간을 그룹으로 정리하고, 로컬 폴더를 선택해 새 Space를 만드는 mod입니다.

[Herdr Toolbox](../../README.md)의 모듈로 관리합니다.

**현재 상태: v0.0.1 설계 단계, 미출시.** 제품 요구사항과 구현 명세를 작성했으며, 기능 구현과 배포 패키지는 준비 중입니다.

| 항목 | 내용 |
|---|---|
| 저장소 | `herdr-toolbox` |
| 모듈 경로 | `mods/space-organizer` |
| mod 이름 | `space-organizer` |
| 목표 버전 | `v0.0.1` |
| 개발 언어 | TypeScript |
| 배포 형식 | JavaScript ESM과 설치 파일을 담은 ZIP |
| 초기 배포 대상 | 부서 내 GitHub private 저장소 접근 권한을 가진 사용자 |

## v0.0.1 목표

| 기능 | 계획 |
|---|---|
| Space 그룹 관리 | 머신별 그룹 생성, 이름 변경, 삭제, 접기와 펼치기 |
| 그룹 소속 관리 | 같은 머신의 Space를 그룹으로 이동하거나 그룹에서 해제 |
| 그룹 상태 표시 | Space 수와 에이전트 상태 표시 |
| 로컬 폴더 선택 | 시스템 폴더 선택창에서 고른 위치로 새 Space 생성 |
| 새 Space 자동 소속 | 로컬 그룹에서 만든 Space를 확인 후 해당 그룹에 배치 |
| 기본 동작 유지 | Space 선택, 이름 변경, 닫기, git 정보와 worktree 작업 유지 |
| 상태 보존과 배포 | 그룹 정보 보존, 설치, 업데이트, 이전 mod 버전 복원 |

원격 Space도 같은 머신 안에서 그룹으로 정리할 계획입니다. 원격 폴더 탐색, 원격 그룹에서 새 Space 생성, 터미널 재시작 후 작업 폴더 복원, PC 간 그룹 동기화는 후속 범위입니다.

그룹 배치는 실제 Space 순서에도 반영하도록 설계합니다. 단축키 번호는 접힌 그룹 안의 Space를 포함한 실제 순서를 따르며, 첫 버전에서는 드래그 재정렬을 제공하지 않습니다.

## 개발 환경

다음은 구현 시 사용할 개발 환경입니다.

| 용도 | 도구 |
|---|---|
| 개발 실행 환경 | Node.js 24 LTS, npm |
| 타입 검사 | TypeScript strict 모드, `tsc --noEmit` |
| 앱용 빌드 | esbuild, ESM 출력 |
| UI와 앱 연동 | Herdr의 `gpui-kit`, `gpui-base`, `herdr` API |
| 로직 테스트 | Node.js 내장 `node:test` |
| 최초 앱 검증 대상 | Windows 11, Herdr App 0.1.16 |

Herdr에 설치하는 결과물은 JavaScript입니다. 배포 사용자는 TypeScript나 Node.js를 설치하지 않아도 되도록 구성할 계획입니다. 앱 버전별 API는 설치된 Herdr의 타입 정의를 기준으로 확인합니다.

## 개발 순서

1. TypeScript 빌드, SDK 타입 정의 준비, Herdr 로딩을 확인합니다.
2. 기본 Spaces를 포팅하고 로컬 폴더 선택을 구현합니다.
3. 그룹 관리, 저장, 순서 조정과 새 Space 자동 소속을 구현합니다.
4. 로직 테스트, 앱 로딩 검사, 실제 앱 조작과 재시작을 검증합니다.
5. 설치와 복원을 검증한 뒤 부서용 배포 패키지를 만듭니다.

`src/`와 `tests/` 디렉터리를 준비했으며 구현 코드는 아직 없습니다. 개발 명령은 모듈 루트인 `mods/space-organizer/`를 기준으로 구성하고, 코드 및 스크립트가 추가되는 시점에 실행 절차를 이 문서에 반영합니다. 브랜치와 릴리스 태그는 [공통 운영 규칙](../../CONTRIBUTING.md)을 따릅니다.

## 설치와 배포

현재 설치 가능한 릴리스는 없습니다. 첫 배포는 `herdr-toolbox` private 저장소의 `space-organizer/v0.0.1` 태그와 GitHub Release로 준비합니다. Release에는 `herdr-space-organizer-v0.0.1.zip`, 체크섬, 변경 내역과 검증한 앱 버전을 제공합니다.

설치 시 기본 mod와 기본 레이아웃을 보존하고, 별도의 `space-organizer` mod와 개인 레이아웃을 사용하도록 설계합니다. 사용자별 그룹 상태, 머신 별칭, 개인 경로는 배포 파일에 포함하지 않습니다. 그룹 정보는 각 사용자 PC에서 관리합니다.

## 문서

- [변경 이력](CHANGE.md): 실제 추가 및 변경 사항과 릴리스 상태를 기록합니다.
- `PRD.md`: 로컬 개발용 제품 요구사항입니다.
- `SPEC.md`: 로컬 개발용 구현 및 검증 명세입니다.

`PRD.md`와 `SPEC.md`는 저장소 루트의 `.gitignore`에 등록되어 GitHub에 올라가지 않습니다. 공유할 제품 설명과 개발 안내는 이 README에서 관리합니다.
