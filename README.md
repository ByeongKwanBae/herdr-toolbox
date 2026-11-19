# Herdr Toolbox

Herdr App의 작업 공간과 개발 흐름을 확장하는 mod 모음입니다. 하나의 저장소에서 여러 mod를 관리하고, 필요한 mod를 골라 설치할 수 있도록 개발합니다.

첫 mod의 그룹 관리·로컬/원격 폴더 선택을 구현하고 로컬·원격 worktree 흐름을 검증한 단계입니다. 설치 가능한 릴리스는 아직 없습니다. TypeScript로 개발하고 Herdr에서 실행하는 JavaScript ESM으로 빌드합니다.

## 모듈

| 모듈 | 설명 | 최신 배포 버전 | 다음 목표 | 상태 | 변경 이력 |
|---|---|---|---|---|---|
| [Space Organizer](mods/space-organizer/README.md) | Space 그룹 관리와 로컬·원격 폴더를 선택한 새 Space 생성 | 미출시 | `v0.0.1` | 그룹·순서·원격 탐색 구현, WSL 생성·worktree 검증, 배포 준비 전 | [CHANGE](mods/space-organizer/CHANGE.md) |

최신 배포 버전에는 실제로 배포한 버전만 기록합니다. 모듈을 추가할 때 이 표에 소개와 문서 링크를 등록하고, 릴리스할 때 버전별 GitHub Release 링크를 연결합니다. 각 모듈의 `Unreleased` 변경 사항은 다음 목표 버전과 구분합니다.

## 사용 안내

사용하려는 모듈의 README에서 기능, 지원 환경과 설치 방법을 확인합니다. 첫 배포부터 이 private 저장소의 GitHub Releases에서 모듈별 ZIP, 체크섬, 변경 내역과 검증한 Herdr 버전을 제공할 계획입니다.

초기 배포 대상은 부서 내 저장소 접근 권한을 가진 사용자입니다. 모듈마다 버전과 배포 일정을 별도로 관리합니다. 사용자별 그룹 설정, 머신 별칭과 개인 경로는 배포물에 포함하지 않습니다.

## 저장소 구조

```text
herdr-toolbox/
├─ README.md                     # 전체 소개와 모듈 목록
├─ CHANGE.md                     # 저장소 구성과 공통 변경 이력
├─ CONTRIBUTING.md               # 개발, 브랜치, 버전과 배포 규칙
├─ .gitignore
├─ mods/
│  └─ space-organizer/
│     ├─ README.md               # 모듈 소개와 사용 안내
│     ├─ CHANGE.md               # 모듈 변경 이력
│     ├─ PRD.md                  # 로컬 개발 문서, Git 제외
│     ├─ SPEC.md                 # 로컬 개발 문서, Git 제외
│     ├─ src/                    # 소스 디렉터리
│     └─ tests/                  # 테스트 디렉터리
├─ shared/                       # 여러 모듈에서 사용하는 공통 코드
└─ scripts/                      # 저장소 공통 개발 및 배포 도구
```

Space Organizer의 `src/`와 `tests/`에는 포팅한 UI, 로컬 생성 로직과 테스트가 있습니다. 모듈 내부 `scripts/`에서 SDK 준비, 타입 검사, ESM 빌드와 개발용 동기화를 제공합니다. 실행 방법과 검증 결과는 모듈 README에서 확인합니다. 공통 코드와 도구는 여러 mod가 실제로 함께 사용할 때 추가합니다.

## 개발과 협업

- `main`을 모든 모듈의 공통 기준 브랜치로 사용합니다.
- 작업마다 `feat/space-organizer/group-management`처럼 모듈과 목적이 드러나는 브랜치를 만듭니다.
- 변경을 검증하고 Pull Request로 `main`에 합친 뒤 작업 브랜치를 정리합니다.
- 릴리스 태그는 `space-organizer/v0.0.1`처럼 모듈 이름과 버전을 함께 사용합니다.
- 공통 코드가 바뀌면 이를 사용하는 모듈도 함께 검증합니다.

세부 절차와 브랜치 예시는 [개발 및 브랜치 운영 규칙](CONTRIBUTING.md)에 있습니다. [공통 코드](shared/README.md)와 [공통 스크립트](scripts/README.md)의 책임도 각 디렉터리에서 설명합니다.

## 문서 관리

이 README는 모듈 목록과 배포 상태를 관리합니다. 기능과 사용법은 각 모듈의 README, 기능 변경 이력은 각 모듈의 CHANGE에 기록합니다. 저장소 구조와 공통 도구 변경은 [최상위 CHANGE](CHANGE.md)에 기록합니다.

모든 경로의 `PRD.md`와 `SPEC.md`는 로컬 개발 자료로 유지하며 `.gitignore`로 Git 관리에서 제외합니다. 공유 문서는 이 두 파일이 없어도 이해하고 사용할 수 있게 작성합니다. 로컬 문서는 Git clone이나 일반적인 브랜치 전환으로 전달되지 않습니다.

## 구조 참고

- [Vite Plugin React](https://github.com/vitejs/vite-plugin-react): 하위 패키지 문서, 버전과 변경 이력을 최상위 표에서 연결합니다.
- [VS Code Extension Samples](https://github.com/microsoft/vscode-extension-samples): 여러 확장을 한 저장소에 두고 각 디렉터리의 문서로 안내합니다.
