import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { getServerStatus, resolvePlanByPnu, resolvePlanByPlanId, analyzeUrbanPlan } from "./urban_plan_service.js";
import { inspectDataset, buildDatasetIndex } from "./dataset_manager.js";
import { searchPlans, findNotices } from "./urban_plan_index.js";
import { fetchNoticeApi } from "./notice_api.js";
import { probeEumPnu, fetchEumNoticeDetailBySeq } from "./eum_web_client.js";

const server = new McpServer({
  name: "korean_urban_plan_mcp",
  version: "0.3.1",
});

const textResult = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const textError = (e) => textResult({ success: false, error: e instanceof Error ? e.message : String(e) });

server.registerTool("get_server_status", {
  description: "토지이음 공식 개방자료 기반 도시계획 MCP의 상태와 로컬 인덱스 상태를 반환합니다.",
  inputSchema: z.object({})
}, async () => textResult(await getServerStatus()));

server.registerTool("inspect_dataset", {
  description: "다운로드해 둔 공식 토지이음 데이터의 실제 파일·컬럼·샘플을 확인합니다. 필드명을 추정하여 연결하지 않고 실제 원자료를 먼저 확인합니다.",
  inputSchema: z.object({ dataset: z.enum(["district_plan", "notice"]), limit: z.number().int().min(1).max(20).default(5) })
}, async ({ dataset, limit }) => {
  try { return textResult(await inspectDataset(dataset, limit)); } catch (e) { return textError(e); }
});

server.registerTool("build_dataset_index", {
  description: "공식 개방자료 CSV/TXT를 로컬 정규화 인덱스로 구축합니다.",
  inputSchema: z.object({ dataset: z.enum(["district_plan", "notice"]) })
}, async ({ dataset }) => {
  try { return textResult(await buildDatasetIndex(dataset)); } catch (e) { return textError(e); }
});

server.registerTool("resolve_plan_by_pnu", {
  description: "PNU로 지구단위계획구역 속성 인덱스를 조회합니다. PNU가 데이터에 직접 존재하지 않으면 공간 인덱스 단계가 필요합니다.",
  inputSchema: z.object({ pnu: z.string().regex(/^\d{19}$/) })
}, async ({ pnu }) => {
  try { return textResult(await resolvePlanByPnu(pnu)); } catch (e) { return textError(e); }
});

server.registerTool("resolve_plan_by_id", {
  description: "지구단위계획구역 식별자로 계획구역 속성을 조회합니다.",
  inputSchema: z.object({ planId: z.string().min(1) })
}, async ({ planId }) => {
  try { return textResult(await resolvePlanByPlanId(planId)); } catch (e) { return textError(e); }
});

server.registerTool("search_plans", {
  description: "지구단위계획구역명·계획ID·고시번호 등으로 계획구역 인덱스를 검색합니다.",
  inputSchema: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(100).default(20) })
}, async ({ query, limit }) => {
  try { return textResult({ success: true, results: searchPlans(query, limit) }); } catch (e) { return textError(e); }
});

server.registerTool("search_plan_notices", {
  description: "계획ID·고시번호·제목 등으로 공식 고시정보 로컬 인덱스를 검색합니다.",
  inputSchema: z.object({ planId: z.string().optional(), noticeNo: z.string().optional(), query: z.string().optional(), limit: z.number().int().min(1).max(100).default(30) })
}, async (input) => {
  try { return textResult({ success: true, results: findNotices(input) }); } catch (e) { return textError(e); }
});

server.registerTool("probe_eum_pnu", {
  description: "PNU를 토지이음 공개 웹 경로에 전달해 도시계획 페이지와 공개 AJAX 응답을 점검합니다. 119.196.18.3:7070/MapPlan을 호출하지 않으며, 170MB 전국 CSV도 사용하지 않습니다.",
  inputSchema: z.object({ pnu: z.string().regex(/^\d{19}$/) })
}, async ({ pnu }) => {
  try { return textResult(await probeEumPnu(pnu)); } catch (e) { return textError(e); }
});

server.registerTool("get_eum_notice_detail", {
  description: "이미 확인된 토지이음 고시 상세 seq를 공개 고시 상세 페이지에서 가져옵니다. seq를 추측하지 않습니다.",
  inputSchema: z.object({ seq: z.string().regex(/^\d+$/) })
}, async ({ seq }) => {
  try {
    const r = await fetchEumNoticeDetailBySeq(seq);
    return textResult({ ...r, html: r.html.slice(0, 20000) });
  } catch (e) { return textError(e); }
});

server.registerTool("fetch_plan_notices_api", {
  description: "공식 고시정보 API endpoint와 승인키가 실제로 설정된 경우에만 호출합니다. endpoint를 MCP가 추정하거나 우회하지 않습니다.",
  inputSchema: z.object({ params: z.record(z.string(), z.string()).optional() })
}, async ({ params }) => {
  try { return textResult(await fetchNoticeApi({ params: params ?? {} })); } catch (e) { return textError(e); }
});

server.registerTool("analyze_urban_plan", {
  description: "PNU/계획ID/고시번호를 바탕으로 계획구역과 고시 인덱스를 통합 조회합니다. 토지이음 내부 MapPlan 서버에 직접 연결하지 않습니다.",
  inputSchema: z.object({
    pnu: z.string().regex(/^\d{19}$/).optional(),
    planId: z.string().optional(),
    noticeNo: z.string().optional(),
    query: z.string().optional(),
    point_wgs84: z.object({ x: z.number(), y: z.number() }).optional(),
    parcel_wkt: z.string().optional(),
    noticeLimit: z.number().int().min(1).max(100).default(30)
  })
}, async (input) => {
  try { return textResult(await analyzeUrbanPlan(input)); } catch (e) { return textError(e); }
});

server.registerTool("discover_tools", {
  description: "현재 MCP 도구 목록과 데이터 공급 구조를 반환합니다.",
  inputSchema: z.object({})
}, async () => textResult({
  server: "korean_urban_plan_mcp",
  version: "0.3.1",
  source: "EUM official open-data files/API",
  tools: [
    "get_server_status",
    "inspect_dataset",
    "build_dataset_index",
    "resolve_plan_by_pnu",
    "resolve_plan_by_id",
    "search_plans",
    "search_plan_notices",
    "fetch_plan_notices_api",
    "analyze_urban_plan"
  ],
  excluded: ["EUM internal MapPlan direct connection", "cvUpisDet.js scraping", "hardcoded sample parcel"]
}));

void serveStdio(server);
console.error("korean_urban_plan_mcp v0.3.1 ready (EUM public web verification + existing open-data features)");
