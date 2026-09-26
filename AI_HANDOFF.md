# AI_HANDOFF.md

> 목적: 새 대화방에서 `korean_urban_plan_mcp` 작업을 이어갈 때, 이전 대화의 장황한 요약 없이 **GitHub의 지정 브랜치 실제 코드 + 이 문서**만으로 작업을 재개할 수 있게 한다.
>
> **최우선 원칙:** 이 문서는 현재 코드의 복사본이 아니다. **실제 GitHub 브랜치의 현재 HEAD와 실제 파일 내용을 먼저 확인한다.** 이 문서와 실제 코드가 다르면 실제 코드를 우선한다.
>
> **중요:** 이 문서에 적힌 커밋 SHA는 현재 HEAD를 고정하는 값으로 취급하지 않는다. 새 커밋이 생길 때마다 SHA가 바뀔 수 있으므로, 새 대화에서는 반드시 GitHub 브랜치의 실제 HEAD를 다시 확인한다.

---

## 1. 프로젝트 식별

### 실제 작업 폴더

`C:\\AI_BOT_SEO\\korean_urban_plan_mcp`

### 현재 GitHub 저장소

`yunsy84/korean_urban_plan_mcp`

> 2026-09-25에 기존 `test_file` 저장소를 `korean_urban_plan_mcp`로 이름 변경했다. 기존 브랜치와 커밋 이력은 유지되며, 현재 로컬 origin도 새 저장소 URL을 가리킨다.

### 현재 작업 브랜치

`urban-plan-source-evidence`

### 브랜치 HEAD 처리 규칙

현재 작업 기준은 항상 GitHub의:

`yunsy84/korean_urban_plan_mcp` → `urban-plan-source-evidence`

브랜치의 **실제 현재 HEAD**다.

이 문서에 기록되는 HEAD SHA는 **기록 당시의 확인값일 뿐 영구 기준값이 아니다.**
새 커밋이 생기면 HEAD는 바뀐다.

따라서 새 대화에서 반드시:
1. 지정 브랜치가 존재하는지 확인
2. **그 시점의 실제 현재 HEAD SHA를 다시 조회**
3. 그 HEAD의 실제 파일 트리를 확인
4. 필요한 실제 소스 파일을 해당 HEAD에서 읽은 후 작업 시작

순서로 진행한다.

`AI_HANDOFF.md`에 적힌 과거 SHA를 보고 그 커밋으로 되돌아가거나,
그 SHA를 현재 상태라고 고정해서는 안 된다.

---

## 2. Git / 로컬 연결 상태

실제 프로젝트 폴더 `C:\\AI_BOT_SEO\\korean_urban_plan_mcp`가 GitHub 저장소와 직접 연결되어 있다.

현재 remote:

`origin -> https://github.com/yunsy84/korean_urban_plan_mcp.git`

GitHub Desktop에 포함된 Git 실행 파일을 사용한다.
일반 PowerShell의 `git` 명령이 반드시 설치되어 있다고 가정하지 않는다.

### 중요

**GitHub 원격 브랜치 상태와 Windows 로컬 프로젝트 상태는 별개의 정보다.**

현재 이 문서를 기준으로 확인했던 로컬 프로젝트 상태는:
- 실제 프로젝트 폴더: `C:\\AI_BOT_SEO\\korean_urban_plan_mcp`
- 로컬 체크아웃 브랜치: `urban-plan-source-evidence`
- 원격 브랜치: `origin/urban-plan-source-evidence`

그러나 이 로컬 상태도 시간이 지나면 바뀔 수 있으므로 새 대화에서 다시 확인해야 한다.

**이 문서는 Pull, Publish, Reset, Switch, Copy 같은 로컬 변경 작업을 승인하는 문서가 아니다.**
사용자가 명시적으로 요청하지 않았다면 로컬 프로젝트의 브랜치 전환·강제 초기화·파일 덮어쓰기·삭제를 하지 않는다.


절대적인 원칙:
- 기존 로컬 작업 파일을 확인 없이 삭제하지 않는다.
- `reset --hard`를 임의로 실행하지 않는다.
- 사용자가 이미 구축한 파일을 다른 임의의 경로로 복제하는 절차를 만들지 않는다.
- GitHub Desktop의 기존 작업 흐름과 실제 프로젝트 폴더를 혼동하지 않는다.

---

## 3. 프로젝트의 목적

`korean_urban_plan_mcp`는 **토지이음(EUM)의 실제 도시계획 / 지구단위계획 결정자료를 확인하는 독립 MCP**다.

핵심 질문:

> 특정 필지(PNU/주소)에 실제로 어떤 도시계획·지구단위계획 결정자료와 고시가 적용되는가?

역할은 다음과 같이 분리한다.

### korean_land_mcp

V-World 기반:
- 필지/PNU
- 지목
- 용도지역
- 용도지구/구역
- 도시계획시설
- 타법 지정사항

### korean_urban_plan_mcp

토지이음(EUM) 기반:
- 지구단위계획구역
- 도시관리계획 / 지구단위계획 관련 결정·변경 이력
- 고시번호 / 고시일 / 기관
- 고시 상세
- 고시 첨부 원자료
- 이후 공식 공간자료(SHP) 기반 필지와의 공간 연결

### law_mcp

- 법령 / 자치법규 조문 검색
- 법적 근거 확인

### 중요한 구조 원칙

`korean_urban_plan_mcp`는 내부에서 `korean_land_mcp`를 호출하지 않는다.

두 MCP 사이의 연결은:
- PNU
- 좌표
- WKT
- parcel geometry

등의 **데이터 계약**으로 한다.

---

## 새 대화에서의 해석 주의사항

사용자가 다음과 같이 지시할 수 있다.

```text
yunsy84/test_file의 urban-plan-source-evidence 브랜치와
AI_HANDOFF.md를 현재 작업 기준으로 사용하라.
실제 코드를 먼저 확인하고 작업을 이어가라.
```

이 지시는 다음을 의미한다.

- GitHub 브랜치의 **실제 현재 HEAD를 먼저 조회**한다.
- 이 문서의 SHA는 현재 상태를 영구 고정하는 값으로 사용하지 않는다.
- 이 문서에 적힌 과거/기록용 상태와 실제 최신 코드가 다르면 실제 최신 코드를 우선한다.
- README의 오래된 파일 목록을 보고 현재 구조를 복원하지 않는다.
- 테스트 파일이 존재한다는 사실과 실제 테스트 통과를 동일하게 취급하지 않는다.
- GitHub 원격 브랜치와 사용자의 Windows 로컬 프로젝트 상태를 동일하다고 가정하지 않는다.
- 실제 실행 결과가 없는 경우 성공을 단정하지 않는다.
- 코드 흐름을 설명할 때 `source_applicability.js`와 `evidence_locator.js`의 실제 호출 관계를 유지한다.
- 작업 전 실제 관련 파일을 읽고, 필요 이상으로 전체 프로젝트를 임의 재구성하지 않는다.

---

## 4. 절대 지켜야 하는 개발 원칙

1. 특정 주소/PNU/고시번호를 하드코딩하지 않는다.
2. 검증되지 않은 토지이음 내부 endpoint를 추측해서 코드에 넣지 않는다.
3. `119.196.18.3:7070/MapPlan` 직접 호출 방식으로 되돌리지 않는다.
4. 토지이음의 내부 GIS 흐름을 추측하여 재구현하지 않는다.
5. 기존에 검증된 코드의 구조를 이유 없이 삭제하거나 전면 재작성하지 않는다.
6. 실제 실행 로그 없이 성공했다고 판단하지 않는다.
7. 샘플 데이터와 일반화된 구현을 구분한다.
8. 지도/결정도처럼 텍스트 추출이 어려운 자료를 OCR만으로 자동 판정했다고 간주하지 않는다.
9. 원본 첨부자료 자체를 보존하는 방향을 유지한다.
10. 새 대화에서 이전 대화의 기억만으로 코드를 재구성하지 않는다. 반드시 실제 GitHub 브랜치의 현재 코드를 읽는다.

---

## 5. 현재까지 확인된 실제 아키텍처

현재 브랜치에는 다음 계열의 코드가 있다.

### EUM 원자료 / 공개 웹 연결

`src/eum_source_client.js`
- 토지이음 공개 페이지 / 공개 응답 처리
- EUM detail `seq` 탐색
- EUC-KR 대응
- 고시 상세 조회와 첨부 다운로드에 필요한 세션/POST 정보 처리

### 고시 파싱

`src/notice_parser.js`
- EUM 고시 상세 HTML에서 첨부 링크 추출
- `FileDownload.do` 링크 처리
- HTML comment 때문에 가짜 첨부가 잡히는 문제 방지
- 다운로드용 POST metadata 작성

### 첨부 저장

`src/attachment_store.js`
- 고시 첨부파일 저장
- cache hit 반환 처리
- POST / headers / body / referer 지원
- 내부 `_download` metadata는 외부 결과에서 제거

### 원자료 적용성 분석

`src/source_applicability.js`

핵심 방향:
- 원본 source package 보존
- 문서의 텍스트 근거를 먼저 활용
- PDF native text 우선
- 필요한 경우 OCR fallback
- 복잡한 결정도/지형도는 무작정 OCR하지 않음

현재 OCR triage:
- 기본 `ocrMaxPages = 24`
- `decision_drawing`, `terrain_map` 역할은 OCR을 건너뜀
- 24페이지 초과 PDF는 OCR을 건너뜀
- `ocrSummary`에 attempted / skipped / skippedReasons 기록
- OCR을 건너뛴 파일을 잘못 `OCR_NOT_CONFIRMED`로 표시하지 않도록 수정됨

### 실제 코드 흐름에 대한 주의

현재 핵심 실행 흐름을 개념적으로 다음처럼 이해한다.

```text
PNU + jibun
 ↓
urban_plan_service.js
 ↓
EUM 공개 경로 / MapPlan 관계 확인
 ↓
고시 식별
 ↓
notice_parser.js
 ↓
첨부파일 후보 추출
 ↓
attachment_store.js
 ↓
원본 첨부 저장
 ↓
source_applicability.js
 ├─ PDF native text
 ├─ HWP/ZIP text
 ├─ 조건부 OCR
 └─ evidence_locator.js
      ↓
      필지 지번 / 문서 근거 위치 탐색
 ↓
urban_plan_service.js의 최종 반환
 ↓
MCP 반환
```

**중요:** `evidence_locator.js`가 `source_applicability.js` 다음에 별도의 독립 실행 단계로 존재하여 `urban_plan_service.js`를 다시 호출하는 구조라고 해석하지 않는다.

실제 코드상 `source_applicability.js`가 `evidence_locator.js`의 기능을 사용하고,
그 결과가 `urban_plan_service.js`의 최종 분석 결과에 포함된다.

따라서 문서에 실행 흐름을 설명할 때는 위 관계를 기준으로 한다.

### 도시계획 서비스

`src/urban_plan_service.js`

주요 역할:
- PNU 검증
- PNU ↔ 지번 일관성 검증
- EUM 공개 페이지 / MapPlan 정보 / 고시 연결
- 고시 상세 및 첨부 조회
- source package 기반 applicability 분석

### PNU / 지번 일관성

PNU는 권위 있는 입력값으로 취급한다.

19자리 PNU에서 필지번호를 추출하고,
입력된 jibun이 서로 다른 필지를 가리키면 네트워크 조회 전에 실패시킨다.

대표 검증:
- PNU `4311111200104600010`
- 지번 `수동 460-10`

이 값은 테스트 자료일 뿐 하드코딩 대상이 아니다.

---

## 6. 최근 수정된 핵심 문제

### requestBuffer body 문제

`src/eum_source_client.js`에서 POST body 처리와 관련된 오류를 수정했다.

기존 문제:
- 함수 시그니처에 body가 제대로 선언되지 않은 상태에서 body를 참조할 가능성

수정:
- `requestBuffer()`가 `body = null`을 명시적으로 받도록 수정

### attachment cache return 문제

`src/attachment_store.js`에서 cache hit 시 반환 객체가 제대로 선언되지 않은 문제 수정.

### EUM POST 첨부 다운로드

EUM의 `FileDownload.do`가 단순 GET으로 끝나지 않는 경우를 확인했다.

현재 방향:
- method
- headers
- body
- referer
- cookie / session

정보를 함께 유지하여 실제 EUM 요청을 재현한다.

### OCR 비용 문제

지도류 PDF까지 OCR을 무조건 수행하면 너무 느리고 실질적으로 적용성 판단 신뢰도가 낮을 수 있다.

따라서 현재는:
1. 텍스트가 있는 문서 우선
2. 필요한 PDF만 OCR
3. 결정도/지형도는 자동 OCR 판정에서 제외
4. 원본 파일은 보존

방향으로 정리되어 있다.

---

## 7. 현재까지 실제 검증된 EUM 관련 사실

### 대표 검증 필지

PNU:

`4311111200104600010`

지번:

`수동 460-10`

이 샘플은 **검증용**이며 일반 로직에서 하드코딩하면 안 된다.

### MapPlan에서 확인된 지구단위계획 관련 정보 예

확인된 `jigu_info` 예:

- `UQS122`
  - present_sn: `43110UQ151PS201612152720`
  - wtnnc_sn: `43110URZ200812265288`
  - fd_code: `CBA`

- `UQS118`
  - present_sn: `43110UQ151PS202006120240`
  - wtnnc_sn: `43110URZ202006120710`
  - fd_code: `CBA`

### 연결된 고시 예

- `43110NTC200904171357`
  - 2009-04-17
  - 고시번호 2009-44
  - 기관: 청주시
  - 제목: 청주도시계획시설 결정(경미한 변경) 및 2015년 청주도시관리계획 지형도면고시

- `43110NTC200812261330`
  - 2008-12-26
  - 고시번호 2008-134

- `43110NTC200201160706`
  - 2002-01-16
  - 고시번호 2002-5

여기서 어떤 고시가 특정 필지에 직접 적용되는지는 **고시 본문/첨부 원자료까지 확인한 뒤 판단**해야 한다.

---

## 8. 고시 seq에 대한 중요 사실

EUM의 detail `seq`는 `wtnnc_sn` 숫자를 단순 변환해서 만들 수 있다고 가정하면 안 된다.

예:
- 고시 `2002-5` 관련 rich detail seq로
  - `197716`
  - `197717`
  를 실제 발견했다.

`197716`:
- `FileDownload.do` 링크 약 101개
- JPG 약 100개
- PDF 1개
- 해당 페이지에서 일괄 다운로드 링크가 comment 처리된 경우가 확인됨

`197717`:
- 직접 PDF
- 일괄 다운로드 링크 존재

따라서 고시번호 / wtnnc_sn / seq는 서로 동일한 식별자로 취급하지 않는다.

---

## 9. 문자 인코딩 관련 주의

토지이음 공개 HTML 응답은 EUC-KR이 섞여 있을 수 있다.

과거 발생했던 문제:
- Node `response.text()`만 사용
- 한글 파일명이 mojibake로 변함
- 결과적으로 실제 첨부가 없는 것으로 잘못 판단

현재는 source client에서 decoding을 명시적으로 다룬다.

따라서:
- UTF-8로 무조건 가정하지 않는다.
- 한글 첨부 검색 결과가 0이라고 해서 즉시 파일 부재로 판단하지 않는다.

---

## 10. 과거 검증에서 확인된 자료 해석 한계

### 2009-44 관련 HWP

ZIP 내부 HWP에서 `460-10`이 직접 검색되지 않았다.

그러나 문서가 광범위한 계획 내용만 포함할 수 있으므로,
이 결과만으로 해당 필지가 관련 없다고 확정하지 않는다.

### 1981-63 관련 PDF

`43110NTC198102280075`:
- ZIP 안에 PDF가 존재
- PDF text layer는 사실상 관보 표제 등만 남고
- 필지 키워드가 직접 나오지 않았다.

이 역시 텍스트 부재 = 적용 부재로 단정하지 않는다.

### 결정도 / 지형도

시각적 공간 관계가 핵심인 자료는 텍스트 추출과 OCR만으로 필지 적용 여부를 확정하는 구조를 만들지 않는다.

---

## 11. 검증용 천안 샘플 주의

다음은 새 MCP 검증용 샘플로 사용했던 자료다.

- 주소: 충청남도 천안시 서북구 백석동 1116
- PNU: `4413310300111160000`
- 면적: `16028.5㎡`
- 지목: `대`
- 용도지역: `준주거지역`
- 지구단위계획구역 존재
- 일부 도시계획시설 존재

**절대 `제1종일반주거지역`으로 바꾸어 쓰지 않는다.**
과거 대화에서 이 값을 잘못 변환한 사례가 있었다.

이 샘플도 일반화 코드에 하드코딩하지 않는다.

---

## 12. 현재 테스트 상태

GitHub 최신 브랜치에서 `tests/index.test.js`가 현재 아키텍처에 맞게 업데이트되었다.

현재 기본 테스트가 확인하는 방향:

1. source package가 다운로드된 원자료 metadata를 보존하는지
2. PNU/jibun mismatch를 네트워크 전에 거부하는지
3. `analyze_urban_plan`이 parcel evidence를 위해 jibun을 요구하는지

과거 테스트가 존재하지 않는 `field_matcher.js`를 import하여 실패한 문제가 있었고,
현재 테스트 파일은 그 구조에서 벗어나도록 수정되었다.

---

## 13. 문서 간 우선순위

### 절대적인 우선순위

새 대화에서 다음 순서를 따른다.

**1순위 — 지정 GitHub 브랜치의 실제 현재 코드**

- 브랜치: `urban-plan-source-evidence`
- 저장소: `yunsy84/korean_urban_plan_mcp`
- 실제 현재 HEAD를 새로 조회한다.
- 필요한 파일은 해당 HEAD에서 직접 읽는다.

**2순위 — `AI_HANDOFF.md`**

- 현재 작업 목적
- 개발 원칙
- 이미 확인된 사실
- 알려진 실패/주의사항
- 작업 재개 절차

를 제공한다.

**3순위 — `README.md`, CHANGELOG 및 기타 문서**

프로젝트 설명과 과거 변경사항 참고용이다.

현재 `README.md`에는 실제 최신 소스 구조와 맞지 않는 레거시 설명이 일부 남아 있다. 따라서 README에 적힌 파일명·도구 목록·구조를 현재 코드라고 가정하지 않는다.

**4순위 — 이전 대화 기억**

이전 대화는 참고 정보일 뿐 현재 코드 상태의 기준이 아니다.

---

## 14. 새 대화 시작 시 반드시 해야 할 것

사용자가 다음과 같이 지시하면:

```
yunsy84/test_file의 urban-plan-source-evidence 브랜치와
AI_HANDOFF.md를 현재 작업 기준으로 사용하라.
실제 코드를 먼저 확인하고 작업을 이어가라.
```

이를 다음처럼 해석한다.

### 단계 A — GitHub 현재 상태 확인

- `urban-plan-source-evidence` 브랜치의 실제 존재 여부 확인
- **현재 HEAD SHA를 실시간으로 확인**
- 해당 HEAD의 파일 트리 확인

### 단계 B — 인계 문서 읽기

- `AI_HANDOFF.md` 전체를 읽는다.
- 특히 개발 원칙, 현재 검증 사실, 실패 사례, 다음 작업 기준을 확인한다.

### 단계 C — 실제 관련 코드 읽기

사용자가 지정한 작업과 직접 관련된 실제 파일을 현재 HEAD에서 읽는다.

예:
```
src/eum_source_client.js
src/notice_parser.js
src/attachment_store.js
src/source_applicability.js
src/evidence_locator.js
src/urban_plan_service.js
src/server.js
tests/index.test.js
```

필요하지 않은 파일까지 무작정 읽어서 구조를 재구성하지 않는다.

### 단계 D — 상태를 혼동하지 않는다

다음 세 가지를 명확하게 구분한다.

```
GitHub 원격 브랜치의 현재 코드
≠
사용자 Windows 로컬 프로젝트의 현재 체크아웃 상태
≠
이전 대화에서 기억하고 있는 코드 상태
```

### 단계 E — 실행 결과를 구분한다

코드를 읽은 것과 실제 실행이 성공한 것은 다르다.

- 소스 코드상 가능해 보임 = 실행 성공 아님
- 테스트 코드가 존재함 = 테스트 통과 아님
- 과거에 통과함 = 현재 HEAD에서도 통과한다는 뜻 아님

실제 Windows 실행 결과가 필요하면 사용자의 실제 실행 로그를 기준으로 판정한다.

---

## 15. 현재 작업의 기술적 방향

현재 단계의 핵심은 단순히 기능을 계속 추가하는 것이 아니라,

**토지이음에서 실제로 얻을 수 있는 도시계획 / 지구단위계획 결정자료와 고시 원문을 필지 단위로 연결하는 신뢰 가능한 경로를 확립하는 것**

이다.

우선순위 판단 시:
1. 실제 EUM source 확인
2. 고시 식별자/seq 정확성 확인
3. 첨부 원자료 확보
4. 원자료의 필지 적용성 근거 확인
5. 필요할 때만 공간자료를 이용
6. 그 뒤 MCP 통합

순으로 접근한다.

단순히 URL/API를 더 추가하는 것을 목표로 삼지 않는다.

---

## 16. 절대로 되풀이하지 말아야 할 이전 실수

- 실제 프로젝트와 GitHub Desktop 작업 폴더를 임의로 다른 복제 폴더로 분리해서 관리하지 않는다.
- 존재하지 않는 `C:\\AI_BOT_SEO\\korean_urban_plan_mcp_copy` 같은 경로를 새로 만들지 않는다.
- 일반 PowerShell에 `git`이 설치되어 있다고 가정하지 않는다.
- GitHub Desktop의 UI 항목 이름을 현재 버전 확인 없이 단정하지 않는다.
- Pull / Publish / Reset / branch switch를 현재 작업물 확인 없이 실행하지 않는다.
- 작은 수정 때문에 1,000줄짜리 파일을 불필요하게 축약하거나 재작성하지 않는다.
- 현재 원본에 없는 코드 파일을 임의로 만들어 기존 구조를 대체하지 않는다.
- 샘플 주소를 기준으로 로직을 하드코딩하지 않는다.
- OCR 결과만으로 지도형 자료의 공간 적용성을 확정하지 않는다.
- 테스트가 반복 실패할 때 같은 명령을 의미 없이 반복하지 말고 실패 원인을 먼저 분석한다.
- README의 오래된 파일 목록을 보고 현재 코드 구조를 거꾸로 만들어내지 않는다.
- 이 문서에 적힌 과거 커밋 SHA를 현재 HEAD라고 단정하지 않는다.
- GitHub 원격 브랜치를 확인했다는 이유만으로 Windows 로컬 프로젝트도 같은 상태라고 가정하지 않는다.

---

## 17. 상태 갱신 규칙

중요한 구조 변경이나 실제 검증 결과가 생기면 이 파일을 함께 갱신한다.

특히 다음은 반드시 갱신:
- 현재 실제 브랜치 구조
- 새로 확인된 endpoint
- 새로 확인된 seq
- 첨부파일 다운로드 방식
- 실제 검증 성공/실패
- 새 테스트 결과
- 현재 남은 문제
- 다음 작업의 정확한 목적
- 더 이상 유효하지 않은 과거 설명

### 커밋 SHA에 대한 규칙

이 문서에 "현재 최신 커밋"이라는 고정 SHA를 기준 상태로 기록하지 않는다.

커밋 SHA는 **그 시점의 역사적 참고값**일 뿐이다.

새 대화는 항상 GitHub 브랜치의 실제 현재 HEAD를 조회하여 시작한다.

### 변경 후 갱신

작업으로 인해 코드가 변경되고 새 커밋이 생성되면,
필요한 경우 다음 대화에서 이 문서와 실제 브랜치 상태가 어긋나지 않도록 갱신한다.

이 문서는 **작업 기억과 개발 규칙을 전달하는 인계 문서**이지,
실제 소스 코드나 Git history를 대신하는 문서가 아니다.

---

## 18. 2026-09-25 디버깅/개선 반영

현재 HEAD의 실제 코드를 다시 점검한 결과, 기능 확장 전에 실행 경로와 원자료 추출의 신뢰성을 보완했다.

### 확인된 문제

1. `dist/server.js`가 현재 `src/server.js`와 다른 구버전 아키텍처였다.
2. 기존 `scripts/build_dist.js`가 `src/server.js` 하나만 복사하여 현재 서버의 실제 import 구조와 맞지 않았다.
3. `package.json`/`package-lock.json` 버전이 `0.3.1`인 반면 현재 MCP runtime은 `0.4.0`이었다.
4. `npm run probe`가 현재 존재하지 않는 구버전 dataset/standalone 경로를 사용했다.
5. HWP 추출이 `BodyText/Section0` 하나만 읽어 다중 Section 문서에서 후속 본문을 놓칠 가능성이 있었다.

### 반영된 개선

- `scripts/build_dist.js`: `dist/server.js`를 현재 `src/server.js`를 호출하는 runtime wrapper로 생성.
- `dist/server.js`: `import "../src/server.js";` 형태로 현재 소스를 직접 실행하도록 정렬.
- `package.json` / `package-lock.json`: 버전 `0.4.0`으로 일치.
- `npm run probe`: 현재 브라우저 기반 `tests/eum_runtime_probe.js`를 사용하도록 변경.
- `tests/dist_sync.test.js`: dist 실행 진입점이 현재 source server를 가리키는지 회귀 테스트 추가.
- `src/source_applicability.js`: HWP `BodyText/SectionN`을 모두 열거하여 Section별 텍스트를 순서대로 추출하도록 보완.

### 현재 검증 상태

위 변경은 GitHub 실제 브랜치에 반영되었다. 다만 이 환경에서는 사용자의 Windows 로컬 `C:\\AI_BOT_SEO\\korean_urban_plan_mcp`에서 실제 `npm run build`, `npm test`, MCP Inspector, EUM 네트워크 요청을 실행한 결과가 아니므로 통과를 단정하지 않는다.

### 다음 단계

1. Windows 로컬에서 `npm run build` 실행.
2. `npm test` 실행.
3. `npm start` 또는 MCP Inspector로 `discover_tools`와 `resolve_urban_plan` 기동 확인.
4. 검증용 PNU 1건에서 `PNU → jigu_info → notice_code → EUM detail seq → attachments → 원자료 → parcel evidence` 전체 흐름을 실제 로그로 확인.
5. 그 로그를 기준으로 고시 식별·첨부 다운로드·필지 적용성 evidence의 남은 오류를 고친다.
6. 그 다음에야 고시별 evidence schema와 최종 MCP 반환 구조를 고정한다.

---

## 19. 2026-09-25 로컬 ↔ GitHub 안전 동기화 구조

### 목적

`C:\\AI_BOT_SEO\\korean_urban_plan_mcp`를 `urban-plan-source-evidence` 원격 브랜치와 연결하여, 이후 GitHub 코드 변경을 로컬에서 최소 작업으로 반영한다.

### 추가 파일

- `tools/sync_urban_plan.ps1`
  - Git 실행 파일을 PATH, 일반 Git 설치 경로, GitHub Desktop의 embedded Git 순으로 탐색.
  - `origin` URL이 `https://github.com/yunsy84/korean_urban_plan_mcp.git`와 다르면 중단.
  - working tree가 dirty이면 중단하고 로컬 변경을 보존.
  - `git fetch origin urban-plan-source-evidence` 수행.
  - Setup 시 대상 로컬 브랜치를 만들거나 기존 브랜치로 전환.
  - Update 시 `git pull --ff-only origin urban-plan-source-evidence`만 수행.
  - `reset --hard`, 강제 pull, 삭제, 복제 폴더 생성은 하지 않음.

- `tools/sync_urban_plan.cmd`
  - PowerShell 스크립트를 실행하는 Windows 1클릭 wrapper.

### 최초 1회 설정

현재 로컬 프로젝트가 GitHub 저장소와 연결되어 있고 working tree가 깨끗한 상태에서:

```powershell
cd C:\\AI_BOT_SEO\\korean_urban_plan_mcp
.\\tools\\sync_urban_plan.ps1 -Action Setup
```

현재 로컬 작업물이 변경되어 있으면 스크립트가 중단한다. 이 경우 기존 작업을 임의로 삭제하거나 reset하지 않는다.

### 이후 업데이트

GitHub에서 `urban-plan-source-evidence`가 수정된 뒤 로컬을 갱신할 때:

```powershell
cd C:\\AI_BOT_SEO\\korean_urban_plan_mcp
.\\tools\\sync_urban_plan.cmd
```

또는 PowerShell에서:

```powershell
.\\tools\\sync_urban_plan.ps1 -Action Update
```

### Status

연결 상태만 확인할 때:

```powershell
.\\tools\\sync_urban_plan.ps1 -Action Status
```

### 안전 규칙

- 로컬 변경사항이 있으면 Pull하지 않는다.
- 대상 branch가 아니면 Update를 실행하지 않는다.
- fast-forward 가능한 경우에만 Pull한다.
- `origin`이 예상 저장소가 아니면 자동 변경하지 않는다.
- GitHub 원격 HEAD와 로컬 HEAD를 출력하여 동기화 결과를 확인한다.

### 현재 구조의 의미

최초 Setup이 완료되면 로컬 프로젝트 폴더 자체가 `urban-plan-source-evidence`를 체크아웃한 작업 폴더가 된다. 이후 GitHub에서 코드가 변경되면 사용자는 sync 명령만 실행하면 된다. 다른 복제 폴더나 별도 worktree를 만들지 않는다.

---

## 20. 2026-09-25 로컬 npm test 1차 실패 및 최소 수정

### 실제 Windows 검증 결과

- `npm run build`: 성공.
- `npm test`: 실패.
- `src/source_applicability.js:139`: HWP Python template과 ZIP Python template의 경계가 잘못되어 `import json`이 JavaScript로 해석되는 SyntaxError 발생.
- `tests/dist_sync.test.js`: `scripts/build_dist.js`가 줄바꿈을 실제 LF가 아니라 문자 `\n`으로 생성하여 wrapper 문자열 비교 실패.

### 최소 수정

- `src/source_applicability.js`: HWP Python template 종료를 `ole.close()` 다음에 명시하고 ZIP template을 별도 시작하도록 수정.
- `scripts/build_dist.js`: runtime wrapper join 구분자를 실제 `"\n"`으로 수정.

### 다음 검증

1. 로컬에서 최신 branch를 sync.
2. `npm run build`.
3. `npm test`.
4. 테스트가 통과하면 MCP 기동과 실제 EUM probe로 이동.


---

## 21. 2026-09-25 Windows build/test 실제 검증

### 실제 실행 결과

- Windows 로컬 `C:\\AI_BOT_SEO\\korean_urban_plan_mcp`에서 `npm run build` 성공.
- `npm test` 성공.
- Node test runner 결과: 4 tests, 4 pass, 0 fail.
- 통과 항목:
  - `dist/server.js` runtime wrapper 회귀 테스트
  - source package 다운로드 첨부 메타데이터 보존
  - PNU/jibun 불일치 사전 차단
  - `analyze_urban_plan` jibun 필수 검증

### 다음 검증 단계

자동 테스트 통과는 핵심 외부 연동이 실제로 정확하다는 의미는 아니다. 다음은 실제 MCP 기동과 EUM 네트워크/원자료 흐름 검증이다.

1. `npm start`로 stdio MCP 서버 기동 확인.
2. MCP Inspector 또는 실제 MCP 클라이언트에서 `discover_tools`, `resolve_urban_plan` 호출 확인.
3. 검증용 PNU로 EUM runtime probe 실행.
4. 실제 `PNU → jigu_info → notice_code → detail seq → attachments → 원자료 → parcel evidence` 전체 흐름 검증.


---

## 22. 2026-09-25 dist 줄바꿈과 core.autocrlf

### 실제 Windows 원인

- 로컬 Git `core.autocrlf=true`.
- `npm run build`가 `dist/server.js`를 LF로 직접 작성.
- Git 작업트리는 CRLF를 기대하여 `git status`에서 `M dist/server.js`가 발생.
- `git diff --ignore-space-at-eol -- dist/server.js` 결과 내용상 차이는 없고 EOL 경고만 확인됨.

### 반영한 최소 수정

- `scripts/build_dist.js`: `node:os`의 `EOL`을 사용하여 플랫폼에 맞는 줄바꿈으로 생성.
- `tests/dist_sync.test.js`: 비교 시 CRLF를 LF로 정규화하여 내용 기준 회귀 테스트.

### 기대 결과

Windows에서 `npm run build` 후에도 `dist/server.js`가 불필요한 dirty 상태가 되지 않아 `sync_urban_plan.cmd`가 정상적으로 동작해야 한다.


---

## 23. 2026-09-25 GitHub 저장소 이름 변경 완료 및 최종 동기화 상태

### 변경 내용

기존 GitHub 저장소:

```text
yunsy84/test_file
```

을 다음으로 변경했다.

```text
yunsy84/korean_urban_plan_mcp
```

기존 로컬 프로젝트 폴더는 그대로 유지했다.

```text
C:\AI_BOT_SEO\korean_urban_plan_mcp
```

로컬 origin을 다음 주소로 재설정했다.

```text
https://github.com/yunsy84/korean_urban_plan_mcp.git
```

### 실제 Git 작업

2026-09-25에 다음 작업을 실제 실행하여 확인했다.

1. `git remote set-url origin https://github.com/yunsy84/korean_urban_plan_mcp.git`
2. `git fetch origin` 성공.
3. 원격 `urban-plan-source-evidence` 브랜치가 로컬보다 1커밋 앞선 상태를 확인.
4. `git pull --ff-only origin urban-plan-source-evidence` 성공.
5. `tools/sync_urban_plan.ps1`의 ExpectedRemote 값을 새 저장소 URL로 변경.
6. 변경 커밋 `ed024931c1214fbd5cd15d169afb14ab8200bcb0` 생성.
7. `git push origin urban-plan-source-evidence` 성공.
8. `.\tools\sync_urban_plan.cmd` 실행 결과 `[SYNC OK]`.

최종 검증값:

```text
Repository :
C:\AI_BOT_SEO\korean_urban_plan_mcp

Origin :
https://github.com/yunsy84/korean_urban_plan_mcp.git

Branch :
urban-plan-source-evidence

Dirty :
False

Local HEAD :
ed024931c1214fbd5cd15d169afb14ab8200bcb0

Remote HEAD :
ed024931c1214fbd5cd15d169afb14ab8200bcb0
```

### 구조 영향

- 로컬 MCP 폴더명은 변경하지 않았다.
- 기존 `.git`과 Git 이력은 유지된다.
- `urban-plan-source-evidence` 브랜치를 계속 사용한다.
- `agent_system`의 MCP 실행 경로는 변경하지 않았다.
- 다른 MCP의 Git 저장소나 MCP 연결은 변경하지 않았다.
- 이후 동기화 기준 저장소명은 `korean_urban_plan_mcp`이다.

### 문서 기준

새 대화에서는 저장소 `yunsy84/korean_urban_plan_mcp`와 브랜치 `urban-plan-source-evidence`의 실제 현재 HEAD를 먼저 확인하고, 그 다음 `AI_HANDOFF.md`와 실제 소스 파일을 읽는다.

이 문서에 기록된 `ed024931...`은 2026-09-25에 확인한 역사적 상태값이며, 이후 새 커밋이 생기면 현재 HEAD는 달라질 수 있다.


---

## 24. 2026-09-25 운영 코드 직접 Evidence 검증 단계

현재 단계에서는 기존 `tests/urban_plan_evidence_extractor.js`의 독립적인 중복 로직을 다시 검증하는 것이 아니라, 실제 운영 코드인 `src/source_applicability.js`를 직접 호출하여 확보된 시행지침/원자료 파일을 검증한다.

### 추가 파일

- `tests/source_applicability_probe.js`
  - 로컬 원자료 파일 1개를 직접 입력받는다.
  - `analyzeTextApplicability()`를 직접 호출한다.
  - 지번/PNU match, native text, OCR fallback, 문서 role, status, snippet을 실제 운영 코드 기준으로 출력한다.

### 실행 목적

시행지침 파일에 대상 지역/지번이 실제로 존재하는지 다음 기준으로 확인한다.

```text
실제 원자료
 ↓
src/source_applicability.js
 ↓
파일 형식 판별
 ↓
원문 추출
 ↓
지번/PNU 탐색
 ↓
필지 Evidence
 ↓
status / snippet / matched source
```

이 결과를 근거로 운영 코드에 필요한 수정만 수행한다. 기존 EUM runtime probe는 이 단계에서 반복하지 않는다.


---

## 25. 2026-09-25 원자료 다운로드 경로 및 재검증 흐름

현재 실제 다운로드 경로는 설정값을 기준으로 한다.

- 설정: `config/urban_plan.config.json`
- `downloadRoot`: `downloads`
- 프로젝트 루트: `C:\\AI_BOT_SEO\\korean_urban_plan_mcp`
- 실제 원자료 저장 루트:
  `C:\\AI_BOT_SEO\\korean_urban_plan_mcp\\downloads`

`src/attachment_store.js`는 더 이상 `cache/notice`를 직접 사용하지 않고 `loadConfig().downloadRoot`를 사용한다.

고시별 첨부파일은 다음 형태로 저장된다.

```
downloads/
  notice/
    <notice_code>/
      001_...
      002_...
```

### 처음부터 다시 검증하는 기준 흐름

검증용 sample PNU:
- PNU: `4413310300111160000`
- 지번: `백석동 1116`

실행 흐름:

1. PNU로 EUM 도시계획 관계 및 고시 목록 조회
2. 실제 반환된 고시 중 검증할 고시를 선택
3. 해당 고시의 EUM detail seq를 실제 페이지에서 발견
4. detail의 첨부 원자료 후보를 추출
5. 첨부파일을 `downloads/notice/<notice_code>/`에 원자료로 저장
6. 저장된 원자료를 `src/source_applicability.js`로 분석
7. 지번/PNU evidence, native text/OCR 여부, matched source, snippet을 확인
8. 최종 결과에서 원자료 파일 경로를 그대로 보존

첨부파일이 실제로 존재하지 않는 상태에서 이전 캐시나 가정된 파일 경로를 이용하여 적용성 검증을 진행하지 않는다.


### 다운로드 자료 Git 추적 제외

고시 첨부 원본은 로컬 검증 데이터이므로 `downloads/*`는 Git 추적 대상에서 제외한다. 저장소에는 `downloads/.gitkeep`만 유지한다. 원본은 사용자의 로컬 `downloads\\notice\\<notice_code>\\`에 보존한다.


### 2026-09-25 HWP FileDownload.do 재검증 결과

실제 Windows 실행에서 다음이 확인되었다.

- 고시: `44130NTC202001020001` / `2020-2`
- EUM detail seq: 2건 발견
- 첨부 후보: PDF 1건 + HWP 1건
- PDF: 약 11.3MB 정상 다운로드
- HWP: 기존 POST 요청은 HTTP 오류가 아닌 47바이트 `text/html; charset=euc-kr` 오류 페이지를 반환
- 오류 본문 미리보기: `해당 파일을 조회할 수 없습니다.`

당시 실제 HWP 응답이 오류 HTML이었기 때문에 `src/attachment_store.js`에 추측성 GET fallback을 추가했다가, 기존 probe에서 해당 GET 방식의 성공 증거가 없음을 확인하여 다시 제거했다.

현재 원칙은 다음과 같다.

1. EUM detail HTML에서 실제 확인된 JavaScript `download(...)` 요청 metadata를 사용한다.
2. 해당 요청으로 받은 응답의 magic/type을 검증한다.
3. 실패하면 그 첨부만 `downloadError`로 기록하고 다른 첨부 분석은 계속한다.
4. 검증되지 않은 GET fallback을 임의로 추가하지 않는다.

공식 EUM 고시 상세 페이지의 실제 첨부 표기는 `천안시 고시 제2020-2호.hwp (6,489 KByte)`였으며, 당시 실제 POST 결과는 오류 HTML이었다.


### 2026-09-25 EUM 일시적 ECONNRESET 대응

실제 end-to-end probe 재실행 중 1단계 PNU 조회에서 `read ECONNRESET`이 발생했다. 이 오류는 원자료/고시 파싱 단계에 도달하기 전 TLS 연결이 재설정된 것이다.

`src/eum_source_client.js`의 내부 `requestBufferOnce()`를 감싸는 `requestBuffer()` 재시도 계층을 추가했다.

- 재시도 대상: `ECONNRESET`, `ECONNREFUSED`, `EPIPE`, `ETIMEDOUT`, `ECONNABORTED`
- 기본 재시도: 최대 2회
- 대기: 400ms, 800ms
- 그 외 오류는 즉시 반환
- 기존 요청 method/header/body는 그대로 재사용

이 변경은 EUM endpoint나 요청 파라미터를 바꾸는 것이 아니라 일시적 연결 재설정에 대한 안정성 보완이다.


### 2026-09-25 기존 프로브 로직을 운영 코드에 적용한 결과

기존 `tests/urban_plan_evidence_extractor.js`의 필지 문자열 정규화와 현재 `src/source_applicability.js`를 비교한 결과, 운영 코드의 `normalize()`가 공백을 제거하지 않아 프로브보다 약한 비교를 수행하고 있었다.

예:
- 입력: `수동 460-10`
- 원자료: `수동460-10번지`

기존 프로브는 공백까지 제거하여 동일하게 비교할 수 있었으나 운영 코드는 놓칠 수 있었다.

반영:
- `src/source_applicability.js`의 `normalize()`에서 whitespace를 제거하도록 수정.
- 회귀 테스트를 `tests/index.test.js`에 추가하여 `수동 460-10` ↔ `수동460-10번지` 매칭을 검증.

첨부 다운로드는 기존 프로브에서 실제로 검증된 HWP 성공 경로가 없었으므로 추측성 `FileDownload.do` GET fallback을 제거했다.
- 운영 코드는 EUM detail에서 추출한 실제 `POST FileDownload.do` metadata를 그대로 사용한다.
- 검증되지 않은 방식은 추가하지 않는다.
- 기존 프로브의 "첨부 하나가 실패해도 다른 첨부를 계속 확인" 방식은 `storeAllAttachments()`에 `continueOnError=true`로 반영했다.
- 실패한 첨부는 `downloadError`와 함께 source package에 남기고, 정상 다운로드된 PDF/HWP 등의 분석은 계속 진행한다.

따라서 현재 단계의 다음 실제 검증은 EUM 통신 재검증이 아니라:
1. `npm test`
2. 기존에 확보했던 실제 원자료가 있는 경우 `source_applicability.js`의 필지 매칭
3. 정상 PDF가 HWP 실패 때문에 전체 분석을 막지 않는지 확인
순이다.


---

## 26. 2026-09-25 tests 전체 대조 및 운영 코드 누락 반영

이번 단계에서는 새로운 EUM 네트워크 probe를 반복하지 않고, 현재 `tests/`에 존재하는 기존 probe들의 로직과 실제 운영 코드의 연결관계를 다시 대조했다.

### 기존 probe에서 확인하여 운영 코드에 반영한 항목

1. `tests/urban_plan_evidence_extractor.js`
   - 공백을 제거하는 필지 문자열 정규화 방식을 운영 `source_applicability.js`에 반영.
   - `수동 460-10`과 `수동460-10번지`처럼 실제 원자료 표기가 달라질 수 있는 경우를 회귀 테스트로 고정.
   - 필지 주변 문맥에서 표 형식 면적값을 추출하는 보조 evidence를 추가.
   - 필지 미발견을 `PASS`로 표시하던 legacy probe 문구를 `INCOMPLETE`로 수정.

2. `tests/eum_notice_attachment_probe.js`
   - 첨부 하나가 실패해도 전체 검증을 중단하지 않고 다음 첨부를 계속 확인하는 원칙을 운영 `storeAllAttachments()`에 반영.
   - 실패 첨부의 `downloadError`를 source package까지 전달.

3. `tests/eum_notice_detail_probe.js` 및 실제 detail parser 확인
   - EUM의 JavaScript `download(...)` 방식이 실제 첨부 다운로드 경로임을 기준으로 유지.
   - 내부 session Cookie가 MCP JSON 결과에 노출되지 않도록 `_download` metadata를 non-enumerable로 변경.
   - `getNoticeDetail()`에서 trace 객체를 만들 때 숨겨진 `_download`를 다시 보존하도록 수정.
   - detail `seq`, detail URL, 다운로드 method/file path 등 재현에 필요한 비민감 metadata를 반환값에 보존.

4. HWPX 누락
   - 기존 운영 코드는 `.hwpx`를 HWP로 잘못 분류하고 ZIP 내부에서도 HWPX를 건너뛸 수 있었다.
   - `.hwpx`를 별도 형식으로 분류하고 `Contents/sectionN.xml`을 추출하는 production path를 추가.
   - ZIP 내부 HWPX도 동일한 경로로 분석하도록 연결.
   - Windows Python이 없는 환경에서는 해당 회귀 테스트를 skip하도록 테스트를 구성.

5. 이미지 원자료 누락
   - `evidence_locator.js`에 이미 `locateImageEvidence()`가 존재했지만 운영 `source_applicability.js`가 이를 호출하지 않고 있었다.
   - PNG/JPEG 등 image attachment에 대한 OCR 보조 Evidence 경로를 연결.
   - 이미지 OCR은 공간적 적용성을 확정하는 근거가 아니라 보조 근거로 취급하고 `IMAGE_OCR_MATCHED_REQUIRES_VISUAL_REVIEW` 상태를 별도로 사용.

6. PDF OCR 출력 옵션 연결
   - `analyze_urban_plan`의 `saveMatchedImages` 옵션이 실제 `locatePdfEvidence()`까지 전달되지 않던 연결 누락을 수정.
   - 기본 저장 위치는 해당 고시 download directory의 `evidence_images`로 연결.

7. 원자료 상태 분리
   - 고시 제목/내용에서 지번이 발견된 것과 첨부 원자료에서 지번이 발견된 것을 분리.
   - metadata만 일치한 경우 `NOTICE_METADATA_MATCHED`로 표시하고 source-document confirmation으로 취급하지 않는다.
   - source 분석 실패도 전체 분석 실패로 전파하지 않고 `source_analysis_error`로 남긴다.

8. 다운로드 무결성
   - binary 응답이 설정된 최대 크기에서 잘린 경우 `truncated`를 전달하고 저장하지 않는다.
   - HWP/PDF 등의 정상 원본이 아닌 HTML 응답을 저장하지 않는 기존 magic/type 검증을 유지.

9. EUM session Cookie 유지
   - 고시 목록 요청과 detail 요청에서 새 Cookie가 기존 Cookie를 덮어써서 session 정보가 사라질 가능성을 줄이기 위해 Cookie name 기준 merge를 추가.

### 현재 회귀 테스트 구성

현재 `tests/*.test.js` 기준으로:
- `tests/index.test.js`: 9개 test 정의
- `tests/dist_sync.test.js`: 1개 test 정의
- 합계 10개 test 정의

포함되는 주요 회귀 범위:
- dist runtime wrapper
- source package metadata
- PNU/jibun 사전 검증
- 공백/표기 차이가 있는 지번 match
- 면적 문맥 extraction
- source analysis error isolation
- EUM download session metadata JSON 노출 방지
- downloadError 보존
- notice metadata-only match 분리
- HWPX production extraction

### 이번 단계 이후 검증 원칙

위 변경사항을 GitHub 실제 브랜치에 commit한 뒤, 2026-09-26 사용자의 Windows 작업 폴더에서 최신 HEAD 기준으로 `npm test`를 실제 실행하여 **10/10 PASS, 0 FAIL, 0 SKIP**을 확인했다.

다음 실제 Windows 검증은 새로운 EUM discovery를 다시 하는 것이 아니라:

```powershell
cd C:\AI_BOT_SEO\korean_urban_plan_mcp
.\tools\sync_urban_plan.cmd
npm run build
npm test
```

순으로 최신 코드를 받아 문법 및 회귀 테스트를 확인한다.

그 다음 실제 EUM 전체 흐름이 필요한 경우 기존에 이미 확보한 검증 자료를 사용하여:
```
PNU
→ notice
→ actual detail seq
→ attachment metadata
→ download
→ source_applicability
→ parcel evidence
```
순으로 확인한다.



### 2026-09-25 전체 프로브 대조 후 추가 보정

후속 교차점검에서 다음 연결 누락을 추가로 수정했다.

- `evidence_locator.locateImageEvidence()`는 OCR 전체 문자열이 아니라 `jibunHits`를 주된 필지 매칭 결과로 반환한다. 운영 `source_applicability.js`가 존재하지 않는 `image.text`를 읽던 부분을 실제 반환 구조에 맞게 수정했다.
- `locateImageEvidence()`가 OCR 원문을 필요시 재검증할 수 있도록 내부 `ocrText`를 함께 반환한다.
- HWP/HWPX fallback 분류에서 파일명 suffix가 모호한 경우에도 `.hwp`와 `.hwpx`를 별도로 판정하도록 정리했다.
- `notice_parser.js`의 내부 `_download` 요청은 계속 non-enumerable로 유지하면서, `getNoticeDetail()`의 trace 객체 생성 과정에서 다시 보존되도록 확인했다.
- EUM detail을 여러 건 순차 조회할 때 앞 detail 응답의 새 session Cookie를 다음 detail 요청에도 전달하도록 수정했다.
- `requestBuffer()`의 다운로드 크기 제한은 정확히 최대 크기에 도달한 정상 응답을 잘린 것으로 오인하지 않도록 `truncated`를 실제 초과시에만 true로 기록한다.
- `analyzeUrbanPlan()`에서 첨부가 없을 때 가짜 현재 경로(`.`)를 noticeDir로 사용하지 않도록 수정했다.

### 현재 확인된 운영 연결

```
server.js
  ↓
urban_plan_service.js
  ↓
eum_source_client.js
  ↓
notice_parser.js
  ↓
attachment_store.js
  ↓
source_applicability.js
  ↓
evidence_locator.js
```

회귀 테스트는 `index.test.js` 9개 + `dist_sync.test.js` 1개로 총 10개 정의이며, 2026-09-26 Windows에서 최신 HEAD `5b55d210155b560921de8dff780fd37109206472` 기준 실행 결과를 확보했다: **10 PASS / 0 FAIL / 0 SKIP**.



---

## 27. 2026-09-26 최신 Windows 실제 검증 결과

사용자가 실제 Windows 로컬 프로젝트에서 다음 순서로 최신 GitHub 브랜치를 동기화하고 빌드/회귀 테스트를 실행했다.

```powershell
cd C:\AI_BOT_SEO\korean_urban_plan_mcp
.\tools\sync_urban_plan.cmd
npm run build
npm test
```

### Git 동기화

```text
Branch      : urban-plan-source-evidence
Local HEAD  : 5b55d210155b560921de8dff780fd37109206472
Remote HEAD : 5b55d210155b560921de8dff780fd37109206472
Dirty       : False
```

### Build

```text
npm run build → PASS
dist/server.js updated as a runtime wrapper for src/server.js
```

### Regression Test

```text
tests 10
pass 10
fail 0
skipped 0
todo 0
```

특히 이전에 Python 실행 감지 오류 때문에 건너뛰던 HWPX 테스트도 실제 실행되어 통과했다.

```text
✔ HWPX source is extracted through the production applicability path
```

따라서 현재 회귀 테스트 기준선은 **10/10 PASS**로 확정한다.

### 다음 실제 기능 검증 단계

회귀 테스트가 완료되었으므로 동일한 unit test나 새로운 중복 probe를 계속 추가하지 않는다.

다음 검증은 실제 EUM 자료 1건을 사용하여:

```text
PNU
→ EUM jigu_info
→ notice_code
→ 실제 detail seq
→ 고시 상세
→ 첨부 요청 metadata
→ 원본 다운로드
→ source_applicability
→ 대상 필지 Evidence
```

의 전체 연결을 확인한다.

이 단계는 회귀 테스트와 별개의 **실데이터 end-to-end 검증**이다.

기존 `tests/urban_plan_download_probe.js`를 우선 사용하며, 특정 주소/PNU/고시번호는 코드에 하드코딩하지 않는다.


---

## 28. 2026-09-26 실제 EUM end-to-end 1차 검증

검증용 천안 필지:

- PNU: `4413310300111160000`
- 지번: `백석동 1116`

실행:

```powershell
node tests\\urban_plan_download_probe.js --pnu 4413310300111160000 --jibun "백석동 1116" --notice-code 44130NTC202001020001 --disable-ocr
```

### 확인된 단계

```text
PNU → EUM resolve
        ↓
noticeCount = 18
        ↓
notice_code = 44130NTC202001020001
        ↓
detail seq = 402467, 48400
        ↓
attachment candidates = 2
        ↓
PDF 원자료 cache hit = 11,299,336 bytes
        ↓
HWP 다운로드 실패를 정상 오류로 보존
```

### 실제 첨부 상태

PDF:

- 파일: `001_천안시고시제2020-2호.pdf`
- 실제 타입: PDF
- 크기: 11,299,336 bytes
- 저장 위치: `downloads/notice/44130NTC202001020001/`
- `cached=true`로 재사용됨

HWP:

- EUM 실제 `FileDownload.do` POST metadata 확보
- 응답 47 bytes
- `text/html; charset=euc-kr`
- HTML alert 응답으로 판정되어 원본 파일로 저장하지 않음
- `downloadError`를 source package에 그대로 보존

### Evidence 결과

이번 실행은 `--disable-ocr`를 사용했다.

```text
status                 : NOT_CONFIRMED_BY_TEXT
matchCount             : 0
parcelNumberCandidates : 0
ocr attempted          : 0
ocr skipped            : 1
```

따라서 이 결과는 **필지가 미적용이라는 판정이 아니다.**

현재 확인된 의미는:

1. EUM 고시와 첨부 원자료까지 연결되었다.
2. 정상적인 PDF 원자료는 확보되었다.
3. HWP가 실제 바이너리 파일이 아니라 오류 HTML로 반환되는 것을 코드가 정확히 식별했다.
4. 이번 실행에서는 OCR을 의도적으로 껐으므로 PDF native text에서 대상 지번 Evidence를 찾지 못했다.
5. 따라서 다음 단계는 새 discovery를 반복하는 것이 아니라 **이미 저장된 실제 PDF를 OCR 허용 상태로 production applicability 경로에 넣어 확인하는 것**이다.

다음 검증에서는 동일 PDF를 다시 다운로드할 필요가 없다.

권장 실행:

```powershell
node tests\\source_applicability_probe.js --file "C:\\AI_BOT_SEO\\korean_urban_plan_mcp\\downloads\\notice\\44130NTC202001020001\\001_천안시고시제2020-2호.pdf" --pnu 4413310300111160000 --jibun "백석동 1116" --notice-code 44130NTC202001020001 --ocr-max-pages 100
```

이 실행의 목적은 `source_applicability.js` 자체만 실제 PDF에 적용하여:

```text
native text match
        또는
OCR match
        또는
페이지 수 제한에 따른 OCR skip
```

중 어느 경로인지 구분하는 것이다.

OCR에서도 Evidence가 발견되지 않으면 그때부터는 결정도/지형도면 같은 시각자료의 공간 적용성을 어떻게 다룰 것인지 별도로 검토한다. 텍스트/OCR 부재만으로 미적용 판정을 내리지 않는다.


---

## 29. 2026-09-26 실제 PDF OCR Evidence 확인

동일하게 확보된 천안시 고시 제2020-2호 PDF에 대해 `source_applicability.js` production-path probe를 OCR 활성화 상태로 실행했다.

실제 결과:

```text
status                  : CONFIRMED_BY_OCR
matchCount              : 1
source evidence count   : 1
ocr attempted           : 1
ocr skipped             : 0
matched page            : 6
matched variant         : 백석동1116번지
```

OCR snippet에서 다음 내용이 실제 확인되었다.

```text
... 가구 및 획지의 규모와 조성에 관한 도시관리계획 결정(변경)조서
...
스1-1 ... 백석동 1116번지 |16,028.5|16,028.5
```

OCR primary Evidence의 추출 면적:

```text
likelyArea : 16,028.5
values     : 16,028.5 / 16,028.5
```

따라서 현재까지 이 샘플에 대해 다음이 실제 연결되었다.

```text
PNU
→ EUM 관련 고시 18건
→ 2020-2 고시
→ detail seq 402467 / 48400
→ PDF 원자료 11,299,336 bytes
→ PDF 6페이지
→ 백석동1116번지 OCR Evidence
→ 16,028.5㎡
```

### 중요한 해석

이 Evidence는 고시 상세 metadata에 지번이 있다는 수준이 아니라 **실제 PDF 원자료의 표에서 대상 지번과 면적이 함께 OCR로 확인된 것**이다.

현재 상태는 텍스트/문서 Evidence 기준으로는 매우 구체적이지만, 결정도·지형도면의 공간적 경계를 자동 판정했다는 뜻은 아니다.

다음 검증은 이 결과를 개별 probe가 아니라 `analyzeUrbanPlan()` 전체 서비스 반환값에서 동일하게 보존하는지 확인한다.

권장 실행:

```powershell
node -e "import('./src/urban_plan_service.js').then(async ({analyzeUrbanPlan}) => { const r = await analyzeUrbanPlan({ pnu: '4413310300111160000', jibun: '백석동 1116', noticeCode: '44130NTC202001020001', download: true }); console.log(JSON.stringify({ success:r.success, notice:r.notice, applicability: { status:r.applicability.status, matchCount:r.applicability.matchCount, matchedSources:r.applicability.matchedSources, ocrSummary:r.applicability.ocrSummary }, sourcePackage:r.sourcePackage }, null, 2)); }).catch(e => { console.error(e.stack || e); process.exitCode=1; })"
```

이 테스트에서는 기존 cache가 정상인 PDF는 재사용하고, 이미 확인된 문제가 있는 HWP는 동일하게 실패 metadata로 남는지까지 함께 확인한다.
