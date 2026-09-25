# korean_urban_plan_mcp

토지이음(EUM)의 공개 도시계획 자료와 고시 원자료를 이용하여, **특정 필지에 어떤 도시계획·지구단위계획 결정자료가 연결되는지 확인하고 원자료 Evidence를 보존하는 독립 MCP**입니다.

이 MCP는 메인 Agent System에서 사용하는 **서브 MCP**이며, `korean_land_mcp` 또는 `law_mcp`를 내부에서 직접 호출하지 않습니다.

---

## 1. 역할

### korean_land_mcp와의 역할 분리

`korean_land_mcp`는 V-World 기반으로 해당 토지의 공간·토지이용 속성을 확인합니다.

- PNU / 주소 / 지번
- 지목
- 용도지역·용도지구·용도구역
- 도시계획시설
- 타법 지정사항
- 기타 토지이용 관련 공간정보

`korean_urban_plan_mcp`는 그 다음 단계에서 **도시계획 결정자료의 출처와 원자료 Evidence**를 확인합니다.

- PNU → EUM 도시계획 관계정보
- 관련 도시계획·지구단위계획 정보
- 결정·변경 고시 이력
- 고시번호 / 고시일 / 기관
- EUM 고시 상세
- 고시 첨부파일
- PDF / HWP / ZIP 등 원자료 보존
- 원자료에서 대상 필지의 적용성 Evidence 탐색

### law_mcp와의 역할 분리

`law_mcp`는 법령·자치법규의 조문 검색과 근거 확인을 담당합니다.

`korean_urban_plan_mcp`는 법률 해석을 하지 않으며, 자연어 법률 판단도 하지 않습니다.

---

## 2. 전체 연결 구조

최종적으로는 다음과 같은 독립 MCP 구조를 목표로 합니다.

```text
메인 Agent System
(Local LLM + Orchestrator)
        │
        ├───────────────┐
        │               │
        ▼               ▼
korean_land_mcp   korean_urban_plan_mcp
   V-World              EUM
   토지 속성        도시계획 원자료/Evidence
        │               │
        └───────┬───────┘
                │
                ▼
             law_mcp
          법령·조례 근거
```

중요한 원칙:

- `korean_urban_plan_mcp`가 `korean_land_mcp`를 내부 호출하지 않습니다.
- `korean_urban_plan_mcp`가 `law_mcp`를 내부 호출하지 않습니다.
- 메인 Agent가 각 MCP를 독립적으로 호출하고 결과를 조합합니다.
- 특정 주소·PNU·고시번호를 소스 코드에 하드코딩하지 않습니다.

---

## 3. 현재 디렉터리 구조

현재 실제 브랜치의 구조는 다음과 같습니다.

```text
korean_urban_plan_mcp/
├─ AI_HANDOFF.md
├─ CHANGELOG_0.3.1.md
├─ HOW_TO_USE_0.3.1.txt
├─ README.md
├─ config/
│  ├─ urban_plan.config.example.json
│  └─ urban_plan.config.json
├─ data/
├─ dist/
│  └─ server.js
├─ logs/
├─ package.json
├─ package-lock.json
├─ scripts/
│  └─ build_dist.js
├─ src/
│  ├─ attachment_store.js
│  ├─ config.js
│  ├─ eum_client.js
│  ├─ eum_source_client.js
│  ├─ evidence_locator.js
│  ├─ notice_parser.js
│  ├─ server.js
│  ├─ source_applicability.js
│  ├─ urban_plan_parser.js
│  └─ urban_plan_service.js
├─ tests/
│  ├─ dist_sync.test.js
│  ├─ eum_direct_probe.js
│  ├─ eum_notice_attachment_probe.js
│  ├─ eum_notice_detail_probe.js
│  ├─ eum_notice_pdf_ocr_probe.js
│  ├─ eum_notice_pdf_probe.js
│  ├─ eum_notice_pdf_text_diagnostic.js
│  ├─ eum_public_probe.js
│  ├─ eum_runtime_probe.js
│  ├─ eum_runtime_probe_backup_20260923.js
│  ├─ index.test.js
  ├─ standalone_probe.js
  ├─ source_applicability_probe.js
  ├─ urban_plan_download_probe.js
  └─ urban_plan_evidence_extractor.js
└─ tools/
   ├─ sync_urban_plan.cmd
   └─ sync_urban_plan.ps1
```

주의:

- README의 구조보다 **현재 실제 소스 트리와 `AI_HANDOFF.md`를 우선**합니다.
- 과거 버전에서 사용하던 `dataset_manager.js`, `urban_plan_index.js`, `notice_api.js`, `eum_web_client.js` 중심의 설명은 현재 핵심 실행 구조가 아닙니다.

---

## 4. 현재 MCP Tool

`src/server.js`에서 등록하는 Tool은 현재 다음 7개입니다.

### 1) resolve_urban_plan

입력:

- `pnu` : 19자리 PNU

역할:

- PNU를 EUM 도시계획 관계정보에 연결
- 관련 도시계획 관계와 연결된 고시 목록을 조회

---

### 2) get_district_plan_history

입력:

- `pnu`

역할:

- PNU에 연결된 도시계획 고시 이력을 날짜순으로 조회

---

### 3) search_urban_plan_notice

입력:

- `pnu`
- `query` (선택)
- `noticeNo` (선택)

역할:

- 해당 PNU에 실제 연결된 EUM 고시 목록 안에서 검색
- 전국 단순 키워드 검색으로 고시를 임의 선정하는 방식이 아닙니다.

---

### 4) get_notice_detail

입력:

- `pnu`
- `noticeCode`

역할:

- 실제 EUM 고시 상세 페이지를 찾음
- 실제 EUM detail `seq`를 확인
- 고시 상세와 첨부자료 후보를 반환

중요:

- `wtnnc_sn`을 EUM 상세 `seq`로 동일시하지 않습니다.
- EUM 고시 목록의 실제 `gvGosiDet.jsp` 링크에서 numeric `seq`를 확인합니다.

---

### 5) get_notice_attachments

입력:

- `pnu`
- `noticeCode`
- `download` (기본값: true)

역할:

- 고시 상세의 실제 첨부파일을 확인
- 필요하면 원본 파일을 로컬 cache에 저장

현재 처리 대상에는 PDF / ZIP / PNG / JPEG / HWP / HWPX 계열 원자료가 포함되며, 이미지 원자료는 OCR 보조 Evidence 경로로 연결됩니다.

---

### 6) analyze_urban_plan

입력:

- `pnu`
- `jibun`
- `noticeCode`
- `download` (기본값: true)
- `saveMatchedImages` (기본값: false)

역할:

- PNU와 지번 일치 여부 확인
- 고시 첨부 원자료를 내려받아 분석
- 텍스트 원자료에서 대상 필지 Evidence 탐색
- 필요 시 PDF/이미지 OCR을 보조적으로 사용
- EUM 원본 첨부자료의 로컬 보존 정보 반환

중요:

- 자연어 법률 판단을 하지 않습니다.
- 결정도·지형도면을 텍스트만으로 완전 판독한다고 가정하지 않습니다.
- OCR 결과가 없다고 해서 자동으로 "미적용"이라고 단정하지 않습니다.

---

### 7) discover_tools

역할:

- MCP 역할과 제공 Tool 목록 확인

현재 반환 역할:

```text
EUM urban-plan source discovery,
text applicability verification
and original-source preservation
```

---

## 5. 핵심 처리 흐름

현재 핵심 서비스는 다음 흐름을 사용합니다.

```text
PNU
 ↓
PNU 형식 검증
 ↓
EUM 도시계획 관계정보
 ↓
jigu_info 정규화
 ↓
fd_code 기반 연결
 ↓
관련 notice_code 수집
 ↓
EUM 고시 목록에서 실제 detail seq 탐색
 ↓
고시 상세 페이지
 ↓
첨부파일 후보 추출
 ↓
원자료 다운로드 / cache 보존
 ↓
PDF / HWP / ZIP 등 원자료 추출
 ↓
지번 / PNU 변형 탐색
 ↓
필지 Evidence 생성
```

핵심은 **고시를 찾는 것과 해당 필지에 실제 적용되는 Evidence를 확보하는 것을 분리**하는 것입니다.

---

## 6. EUM Source Client

`src/eum_source_client.js`가 현재 EUM 공개 경로의 핵심 통신을 담당합니다.

주요 기능:

- EUM 공개 페이지 요청
- MapPlan PNU 연결
- 공개 UrlConnector 요청
- EUM 고시 목록 조회
- 실제 detail `seq` 탐색
- 상세 페이지 다운로드
- binary 원자료 다운로드

### 내부 서버 주소에 대한 원칙

다음과 같은 확인되지 않은 내부 주소를 코드에 추측하여 넣지 않습니다.

```text
119.196.18.3:7070/MapPlan
```

현재 코드는 검증된 공개 경로와 실제 확인된 요청 구조를 기준으로 작업합니다.

---

## 7. 고시 상세와 첨부파일

`src/notice_parser.js`는 고시 상세 HTML에서 첨부자료 정보를 추출합니다.

처리 대상 예:

- 일반 링크
- JavaScript 기반 `download(...)` 링크
- 파일명
- 파일 종류
- 다운로드 endpoint
- 필요한 POST metadata

`src/attachment_store.js`는 실제 파일을 로컬에 저장하고 다음을 관리합니다.

- 안전한 파일명
- 파일 확장자
- Content-Type
- magic byte
- cache 경로
- 다운로드 여부
- 기존 캐시 재사용

---

## 8. 원자료 적용성 / Evidence

`src/source_applicability.js`는 원자료에서 대상 필지의 적용성 정보를 찾는 역할을 합니다.

### 텍스트 처리

- PNU 필지번호 변형
- 지번 표기 변형
- 텍스트 내 일치 탐색
- 주변 문맥 snippet

### PDF

- native text 추출
- 필요한 경우 OCR 보조
- 문서 역할별 처리

### HWP

현재 `BodyText/SectionN`을 찾아 Section별 본문을 순서대로 추출합니다.

### ZIP

ZIP 내부 원자료 중 PDF/HWP/OLE/text 계열을 분류하여 추출합니다.

### 적용성 상태

현재 결과 체계는 다음과 같은 구분을 사용합니다.

```text
CONFIRMED_BY_TEXT
CONFIRMED_BY_OCR
IMAGE_OCR_MATCHED_REQUIRES_VISUAL_REVIEW
NOTICE_METADATA_MATCHED
TEXT_SOURCE_UNAVAILABLE
OCR_NOT_CONFIRMED
NOT_CONFIRMED_BY_TEXT
```

이는 "텍스트에서 찾지 못함"과 "적용되지 않음"을 동일하게 취급하지 않기 위한 구조입니다.

---

## 9. Evidence Locator

`src/evidence_locator.js`는 PDF/이미지에서 Evidence 후보를 찾는 보조 모듈입니다.

주요 기능:

- 시행지침 관련 페이지 식별
- 결정도 관련 페이지 식별
- 지형도면 관련 페이지 식별
- 필지번호 문맥 탐색
- PDF 페이지 범위 구성
- 이미지 OCR

결정도나 지형도면은 시각 자료이므로, 텍스트 검색 결과만으로 적용 여부를 단정하지 않는 것을 기본 원칙으로 합니다.

---

## 10. 원자료 보존 원칙

이 MCP의 최종 목적은 LLM이 원자료를 읽고 임의로 요약하는 것만이 아닙니다.

```text
EUM 원본
 ↓
다운로드
 ↓
로컬 보존
 ↓
Evidence 탐색
 ↓
원본 파일 위치와 메타데이터 유지
 ↓
메인 Agent에서 후속 판단에 활용
```

따라서 가능하면 원자료 파일과 해당 출처 메타데이터를 함께 보존합니다.

---

## 11. 로컬 대용량 데이터

프로젝트 내부에는 향후 다음과 같은 로컬 데이터가 들어갈 수 있습니다.

```text
data/
├─ district_plan/
└─ notice/

cache/
downloads/
index/
logs/
tmp/
```

원칙은:

- 코드/테스트/설정 템플릿은 GitHub에서 관리
- 대용량 원자료, 다운로드 파일, OCR 결과, 생성 인덱스는 로컬 관리
- 특정 PC의 절대경로를 소스 코드에 하드코딩하지 않음
- 로컬 데이터 경로가 필요한 경우 설정/환경변수로 분리

현재 `.gitignore`는 `node_modules`, 환경파일/로그 및 로컬 원자료 다운로드(`downloads/*`)를 제외합니다. `data/`, `index/`, OCR 결과 등 생성 데이터는 실제 사용 범위를 확인하면서 별도 Git 추적 정책을 정합니다.

---

## 12. 설정

현재 예시 설정은:

```text
config/urban_plan.config.example.json
```

에 있습니다.

현재 설정 구조는 데이터 루트와 EUM 자료 필드 매핑을 위한 기반을 제공합니다.

실제 실행에 필요한 환경별 설정은:

```text
config/urban_plan.config.json
```

에서 관리합니다.

비밀번호나 API key 등 민감한 값은 소스에 직접 넣지 않습니다.

---

## 13. 실행

### 설치

```powershell
cd C:\AI_BOT_SEO\korean_urban_plan_mcp
npm install
```

### 빌드

```powershell
npm run build
```

현재 `dist/server.js`는 별도 복제 서버가 아니라 현재 `src/server.js`를 실행하는 runtime wrapper입니다.

### 테스트

```powershell
npm test
```

### MCP 서버 단독 기동 확인

```powershell
npm start
```

정상 기동 시 예:

```text
korean_urban_plan_mcp v0.4.0 ready
```

이 서버는 stdio MCP이므로 여기서 일반 웹페이지가 열리는 것이 아니라 MCP 클라이언트의 연결과 Tool 호출을 기다립니다.

---

## 14. EUM Probe

실제 EUM 요청을 점검하기 위한 별도 probe가 있습니다.

### 브라우저 runtime probe

```powershell
node tests\eum_runtime_probe.js 4413310300111160000
```

PNU는 실행 시 인자로 전달하며 소스 코드에 하드코딩하지 않습니다.

이 probe의 목적은:

```text
PNU
 ↓
EUM 도시계획 페이지
 ↓
실제 JavaScript 실행
 ↓
실제 Network 요청
 ↓
응답 본문/식별정보 확인
```

입니다.

### 기타 EUM 진단

현재 `tests/`에는 다음과 같은 세부 진단 probe도 있습니다.

- `eum_public_probe.js`
- `eum_direct_probe.js`
- `eum_notice_detail_probe.js`
- `eum_notice_attachment_probe.js`
- `eum_notice_pdf_probe.js`
- `eum_notice_pdf_text_diagnostic.js`
- `eum_notice_pdf_ocr_probe.js`

이 파일들은 전체 MCP 기능을 대체하지 않고, EUM 특정 구간을 독립적으로 검증할 때 사용합니다.

---

## 15. 현재 npm scripts

```json
{
  "start": "node dist/server.js",
  "dev": "node src/server.js",
  "build": "node scripts/build_dist.js",
  "probe": "node tests/eum_runtime_probe.js",
  "probe:eum": "node tests/eum_public_probe.js",
  "test": "node --test tests/*.test.js"
}
```

---

## 16. GitHub ↔ 로컬 동기화

현재 로컬 프로젝트는 다음 GitHub 저장소와 연결되어 있습니다.

```text
Repository:
yunsy84/korean_urban_plan_mcp

Branch:
urban-plan-source-evidence

Local:
C:\AI_BOT_SEO\korean_urban_plan_mcp
```

### 이후 GitHub 변경 반영

GitHub에서 코드가 수정된 뒤 로컬에서:

```powershell
cd C:\AI_BOT_SEO\korean_urban_plan_mcp
.\tools\sync_urban_plan.cmd
```

만 실행하면 됩니다.

동기화 스크립트는:

- origin 저장소 확인
- 대상 branch 확인
- local working tree 변경 여부 확인
- 변경사항이 있으면 Pull 중단
- `git fetch`
- `git pull --ff-only`
- Local HEAD / Remote HEAD 표시

순서로 동작합니다.

`reset --hard`나 강제 Pull을 수행하지 않습니다.

### 동기화 확인

```powershell
.\tools\sync_urban_plan.ps1 -Action Status
```

---

## 17. 현재 실제 검증 상태

2026-09-25 기준 Windows 로컬에서 다음이 실제 확인되었습니다.

### Git

- GitHub ↔ 로컬 연결 정상
- `urban-plan-source-evidence` branch 사용
- Local HEAD와 Remote HEAD 일치
- working tree clean 상태 확인

### Build / Test

아래 수치는 **이번 전체 tests 감사 및 추가 수정 전에 Windows에서 실제 실행했던 과거 결과**입니다.

```text
npm run build     PASS
npm test          PASS

tests   4
pass    4
fail    0
```

이번 감사에서 `tests/index.test.js`가 9개, `tests/dist_sync.test.js`가 1개로 확장되어 **현재 회귀 테스트 정의는 총 10개**입니다. 이 10개는 최신 코드 수정 후 아직 Windows에서 재실행하지 않았습니다.

통과 테스트:

1. dist runtime wrapper 회귀 테스트
2. source package의 원본 첨부 메타데이터 보존
3. PNU/jibun 불일치 사전 차단
4. `analyze_urban_plan`의 jibun 필수 검증

### 아직 실제로 끝까지 검증하지 않은 부분

다음 전체 체인은 아직 실제 데이터 한 건으로 최종 통과 로그를 확보하는 단계입니다.

```text
PNU
 ↓
jigu_info
 ↓
notice_code
 ↓
EUM detail seq
 ↓
고시 상세
 ↓
첨부파일
 ↓
원자료
 ↓
필지 적용성 Evidence
```

자동 테스트 4/4 PASS는 위 외부 EUM 전체 체인이 정확하다는 의미가 아닙니다.

---

## 18. 다음 개발 단계

현재 기본 실행과 회귀 테스트가 통과했으므로 다음 작업은 실제 기능 검증입니다.

### 1. MCP 실제 연결

메인 Agent System에서 `korean_urban_plan_mcp`를 stdio MCP로 등록하고 Tool discovery 및 실제 호출을 확인합니다.

### 2. EUM 실제 PNU 검증

검증용 PNU 하나를 정하여:

```text
PNU
→ jigu_info
→ notice_code
```

를 실제 요청으로 확인합니다.

### 3. 고시/첨부 검증

```text
notice_code
→ detail seq
→ 고시 상세
→ attachment
→ 원본 다운로드
```

를 확인합니다.

### 4. 필지 Evidence 검증

원자료에서 실제 대상 지번/PNU에 대한 근거가 어떻게 발견되는지를 확인합니다.

### 5. 반환 Schema 고정

실제 로그를 기준으로:

- 고시 식별정보
- 원자료 파일 정보
- Evidence
- 적용성 상태
- 출처 추적정보

의 최종 MCP 반환 구조를 고정합니다.

실제 데이터 검증 전에는 불필요한 대규모 구조 변경을 하지 않습니다.

---

## 19. 개발 원칙

- 현재 동작하는 코드는 필요한 범위에서만 수정합니다.
- 특정 샘플 주소/PNU/고시번호를 하드코딩하지 않습니다.
- 실제 요청/응답을 확인하지 않은 endpoint를 추측하여 추가하지 않습니다.
- 테스트 존재와 테스트 통과를 구분합니다.
- 소스 코드의 가능성과 실제 Windows 실행 결과를 구분합니다.
- 원자료가 텍스트에서 확인되지 않는다고 자동으로 미적용 판정하지 않습니다.
- 결정도·지형도면 등 시각 자료는 별도의 Evidence로 취급합니다.
- 법률 해석은 `law_mcp`의 역할로 분리합니다.
- `korean_land_mcp`와 `korean_urban_plan_mcp`의 역할을 섞지 않습니다.
- 샘플 PNU는 검증용 데이터일 뿐 구현의 하드코딩 대상이 아닙니다.

---

## 20. 관련 문서

### AI_HANDOFF.md

현재 작업 상태, 확정된 사실, 실제 검증 결과, 주의사항, 다음 단계의 기준 문서입니다.

### config/urban_plan.config.example.json

설정 구조의 예시입니다.

### CHANGELOG_0.3.1.md / HOW_TO_USE_0.3.1.txt

이전 개발 단계의 기록입니다. 현재 실제 코드 구조를 판단할 때는 `AI_HANDOFF.md`와 현재 `src/`를 우선합니다.


---

## 21. 2026-09-25 GitHub 저장소 이름 변경 및 동기화 검증

기존 GitHub 저장소 `yunsy84/test_file`은 2026-09-25에 `yunsy84/korean_urban_plan_mcp`로 이름을 변경했다.

현재 로컬 프로젝트와 GitHub의 연결은 다음과 같다.

```text
Local:
C:\AI_BOT_SEO\korean_urban_plan_mcp

Remote:
https://github.com/yunsy84/korean_urban_plan_mcp.git

Branch:
urban-plan-source-evidence
```

로컬 Git의 origin URL과 `tools/sync_urban_plan.ps1`의 저장소 검증값도 새 저장소 주소로 정리했다.

이 변경은 저장소 이름과 Git remote 및 동기화 검증값만 정리한 것이며, `agent_system`의 실제 MCP 실행 경로 `C:\AI_BOT_SEO\korean_urban_plan_mcp\dist\server.js`는 변경하지 않았다.

### 실제 검증

2026-09-25 Windows 로컬에서 다음을 실제 확인했다.

- `git remote -v`: 새 `korean_urban_plan_mcp.git` 주소 확인
- `git fetch origin`: 성공
- `git pull --ff-only origin urban-plan-source-evidence`: 성공
- `tools/sync_urban_plan.ps1`의 ExpectedRemote 변경 커밋 push 성공
- `tools/sync_urban_plan.cmd`: `[SYNC OK]`
- Local HEAD와 Remote HEAD가 `ed024931c1214fbd5cd15d169afb14ab8200bcb0`으로 일치
- working tree: `Dirty = False`

따라서 현재 이 저장소는 로컬 MCP 폴더, GitHub 저장소, 동기화 스크립트가 모두 `korean_urban_plan_mcp` 이름으로 일치하는 상태이다.


## 원자료 다운로드 경로

고시 첨부 원자료는 `config/urban_plan.config.json`의 `downloadRoot`를 사용하며 현재 값은 `downloads`이다. 프로젝트 루트 기준 실제 저장 위치는:

```
C:\\AI_BOT_SEO\\korean_urban_plan_mcp\\downloads
```

고시별로 `downloads/notice/<notice_code>/` 아래에 원자료가 저장된다. 검증은 캐시된 파일을 가정하지 않고 **PNU → 고시 → detail → 첨부 다운로드 → source_applicability evidence** 순서로 실제 원자료를 확보한 뒤 수행한다.


---

## 26. 2026-09-25 tests 전체 대조 및 운영 코드 반영

기존 `tests/`의 EUM runtime/detail/attachment/PDF/OCR/evidence probe를 다시 대조하여, 이미 확인된 로직과 현재 운영 코드 사이의 누락을 최소 수정으로 반영했다.

### 반영된 핵심 누락

- 지번 공백 정규화 및 표기 변형 매칭
- 원자료 문맥의 표 형식 면적값 보조 추출
- 첨부 하나의 다운로드 실패가 전체 분석을 중단하지 않도록 분리
- 실패한 첨부의 `downloadError` 보존
- EUM JavaScript `download(...)` 내부 Cookie의 MCP JSON 노출 방지
- detail seq / detail URL / 비민감 다운로드 추적정보 보존
- HWPX 별도 분류 및 `Contents/sectionN.xml` 기반 텍스트 추출
- ZIP 내부 HWPX 분석 연결
- PNG/JPEG 등 이미지 원자료 OCR 보조 경로 연결
- `analyze_urban_plan.saveMatchedImages` → PDF evidence locator 전달
- 고시 metadata match와 실제 원자료 match 분리
- 원자료 분석 예외를 `source_analysis_error`로 격리
- 다운로드 응답 `truncated` 무결성 검사
- EUM session Cookie 누적 유지

### 중요한 판정 원칙

고시 제목이나 설명에 지번이 포함되어 있어도 그것만으로 원자료 적용성을 확정하지 않는다. 실제 첨부 원자료에서 확인된 evidence와 metadata-only match를 구분한다.

또한 지도/결정도/지형도면 이미지에서 OCR로 지번이 발견되는 것만으로 공간 적용성을 확정하지 않고 `IMAGE_OCR_MATCHED_REQUIRES_VISUAL_REVIEW`로 별도 표시한다.

### 현재 회귀 테스트 수

`tests/*.test.js` 기준 **10개 test 정의**가 존재한다.

이는 최신 변경 후 Windows에서 실제 `npm test`를 다시 실행했다는 뜻은 아니다. 마지막으로 실제 실행된 과거 결과와 이번 수정 후의 실행 결과를 구분하여 기록한다.

이번 단계의 최신 검증은 다음 명령으로 수행한다.

```powershell
cd C:\AI_BOT_SEO\korean_urban_plan_mcp
.\tools\sync_urban_plan.cmd
npm run build
npm test
```

