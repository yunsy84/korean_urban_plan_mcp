# v0.3.1 변경사항

기준: 기존 v0.3.0 rearch를 보존하고 EUM 공개 웹 검증 기능만 추가.

## 추가
- `src/eum_web_client.js`
  - 토지이음 `cvUpisDet.jsp` 공개 페이지 GET
  - `luLandDetCheckAjaxXml.jsp` 공개 AJAX POST
  - `mpSearchMapAjaxXml.jsp` 공개 AJAX POST
  - `cvUpisDetGosiAjax.jsp` 최근 고시 공개 AJAX GET
  - `gvGosiDet.jsp?seq=` 공개 고시 상세 GET
- `tests/eum_public_probe.js`
- MCP tools `probe_eum_pnu`, `get_eum_notice_detail`

## 유지
- 기존 CSV/TXT 데이터 인덱스 관련 코드
- 기존 `notice_api.js`
- 기존 `urban_plan_index.js`
- 기존 spatial/dataset 구조

## 의도적으로 제외
- `119.196.18.3:7070/MapPlan` 직접 호출
- 토지이음 내부 MapPlan 재구현
- 전국 170MB CSV를 기본 조회원으로 사용하는 구조
- 미확인 endpoint 추정
