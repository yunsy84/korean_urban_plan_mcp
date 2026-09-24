import {
  McpServer
} from "@modelcontextprotocol/server";

import {
  serveStdio
} from "@modelcontextprotocol/server/stdio";

import * as z from "zod/v4";

import {
  resolveUrbanPlan,
  getDistrictPlanHistory,
  searchUrbanPlanNotice,
  getNoticeDetailForPnu,
  getNoticeAttachmentsForPnu,
  analyzeUrbanPlan
} from "./urban_plan_service.js";

const server =
  new McpServer({
    name:
      "korean_urban_plan_mcp",

    version:
      "0.4.0"
  });

function textResult(
  data
) {
  return {
    content: [
      {
        type:
          "text",

        text:
          JSON.stringify(
            data,
            null,
            2
          )
      }
    ]
  };
}

function textError(
  error
) {
  return textResult({
    success:
      false,

    error:
      error instanceof Error
        ? error.message
        : String(error)
  });
}

/*
 * ------------------------------------------------------------
 * resolve_urban_plan
 * ------------------------------------------------------------
 */

server.registerTool(
  "resolve_urban_plan",
  {
    description:
      "PNU를 EUM 공개 도시계획 경로에 연결하여 관련 도시계획 관계와 고시 목록을 조회합니다.",

    inputSchema:
      z.object({
        pnu:
          z.string()
            .regex(
              /^\d{19}$/
            )
      })
  },

  async ({
    pnu
  }) => {
    try {
      return textResult(
        await resolveUrbanPlan({
          pnu
        })
      );
    } catch (error) {
      return textError(
        error
      );
    }
  }
);

/*
 * ------------------------------------------------------------
 * get_district_plan_history
 * ------------------------------------------------------------
 */

server.registerTool(
  "get_district_plan_history",
  {
    description:
      "PNU에 연결된 도시계획 고시 이력을 최신 날짜순으로 반환합니다.",

    inputSchema:
      z.object({
        pnu:
          z.string()
            .regex(
              /^\d{19}$/
            )
      })
  },

  async ({
    pnu
  }) => {
    try {
      return textResult(
        await getDistrictPlanHistory({
          pnu
        })
      );
    } catch (error) {
      return textError(
        error
      );
    }
  }
);

/*
 * ------------------------------------------------------------
 * search_urban_plan_notice
 * ------------------------------------------------------------
 *
 * 전국 검색이 아니라,
 * 입력 PNU에 실제 연결된 EUM 고시 목록에서 검색한다.
 */

server.registerTool(
  "search_urban_plan_notice",
  {
    description:
      "PNU에 실제 연결된 EUM 고시 목록을 고시명·고시번호·관련 명칭으로 검색합니다.",

    inputSchema:
      z.object({
        pnu:
          z.string()
            .regex(
              /^\d{19}$/
            ),

        query:
          z.string()
            .optional(),

        noticeNo:
          z.string()
            .optional()
      })
  },

  async (input) => {
    try {
      return textResult(
        await searchUrbanPlanNotice(
          input
        )
      );
    } catch (error) {
      return textError(
        error
      );
    }
  }
);

/*
 * ------------------------------------------------------------
 * get_notice_detail
 * ------------------------------------------------------------
 */

server.registerTool(
  "get_notice_detail",
  {
    description:
      "PNU와 실제 notice_code를 받아 EUM 고시 상세 페이지와 첨부파일 목록을 조회합니다.",

    inputSchema:
      z.object({
        pnu:
          z.string()
            .regex(
              /^\d{19}$/
            ),

        noticeCode:
          z.string()
            .min(1)
      })
  },

  async ({
    pnu,
    noticeCode
  }) => {
    try {
      return textResult(
        await getNoticeDetailForPnu({
          pnu,
          noticeCode
        })
      );
    } catch (error) {
      return textError(
        error
      );
    }
  }
);

/*
 * ------------------------------------------------------------
 * get_notice_attachments
 * ------------------------------------------------------------
 */

server.registerTool(
  "get_notice_attachments",
  {
    description:
      "실제 EUM 고시 첨부파일을 확인하고 필요하면 PDF/JPG/PNG/ZIP 원본을 로컬 cache에 다운로드합니다.",

    inputSchema:
      z.object({
        pnu:
          z.string()
            .regex(
              /^\d{19}$/
            ),

        noticeCode:
          z.string()
            .min(1),

        download:
          z.boolean()
            .default(true)
      })
  },

  async ({
    pnu,
    noticeCode,
    download
  }) => {
    try {
      return textResult(
        await getNoticeAttachmentsForPnu({
          pnu,
          noticeCode,
          download
        })
      );
    } catch (error) {
      return textError(
        error
      );
    }
  }
);

/*
 * ------------------------------------------------------------
 * analyze_urban_plan
 * ------------------------------------------------------------
 *
 * 요약하지 않는다.
 *
 * 반환:
 * - 텍스트 원자료 기반 적용성
 * - 적용성 근거가 발견된 문서
 * - EUM 원본 첨부자료 전체의 보존 위치
 */

server.registerTool(
  "analyze_urban_plan",
  {
    description:
      "고시의 텍스트 원자료에서 대상 필지 적용 여부를 확인하고, EUM이 제공한 원본 첨부자료 전체의 로컬 보존 위치를 반환합니다. 오래된 결정도·지형도면을 필지 OCR로 판독한다고 가정하지 않으며 자연어 요약이나 법률 판단은 하지 않습니다.",

    inputSchema:
      z.object({
        pnu:
          z.string()
            .regex(
              /^\d{19}$/
            ),

        jibun:
          z.string()
            .min(1),

        noticeCode:
          z.string()
            .min(1),

        download:
          z.boolean()
            .default(true),

        saveMatchedImages:
          z.boolean()
            .default(false)
      })
  },

  async (input) => {
    try {
      return textResult(
        await analyzeUrbanPlan(
          input
        )
      );
    } catch (error) {
      return textError(
        error
      );
    }
  }
);

/*
 * ------------------------------------------------------------
 * discover_tools
 * ------------------------------------------------------------
 */

server.registerTool(
  "discover_tools",
  {
    description:
      "현재 Urban Plan MCP의 역할과 도구를 반환합니다.",

    inputSchema:
      z.object({})
  },

  async () =>
    textResult({
      server:
        "korean_urban_plan_mcp",

      version:
        "0.4.0",

      role:
        "EUM urban-plan source discovery, download and evidence-location",

      tools: [
        "resolve_urban_plan",
        "get_district_plan_history",
        "search_urban_plan_notice",
        "get_notice_detail",
        "get_notice_attachments",
        "analyze_urban_plan"
      ],

      doesNotDo: [
        "natural-language urban-plan summary",
        "legal interpretation",
        "law_mcp processing",
        "korean_land_mcp invocation"
      ]
    })
);

void serveStdio(
  server
);

console.error(
  "korean_urban_plan_mcp v0.4.0 ready"
);