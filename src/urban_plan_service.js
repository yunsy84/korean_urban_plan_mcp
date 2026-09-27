import path from "node:path";

import {
  getEumPublicPage,
  callMapPlanPnu,
  callNoticeConnector
} from "./eum_source_client.js";

import {
  getNoticeDetail
} from "./notice_parser.js";

import {
  storeAllAttachments
} from "./attachment_store.js";

import {
  analyzeTextApplicability,
  buildSourcePackage
} from "./source_applicability.js";


function normalizeJiguInfo(
  payload
) {
  const rows =
    Array.isArray(
      payload?.jigu_info
    )
      ? payload.jigu_info
      : [];

  return rows.map(
    (row) => ({
      code:
        String(
          row?.code ?? ""
        ),

      present_sn:
        String(
          row?.present_sn ?? ""
        ),

      wtnnc_sn:
        String(
          row?.wtnnc_sn ?? ""
        ),

      fd_code:
        String(
          row?.fd_code ?? ""
        )
    })
  );
}


function parsePnuParcel(
  pnu
) {
  const value =
    String(pnu ?? "");

  if (!/^\d{19}$/.test(value)) {
    throw new Error(
      "PNU must be exactly 19 digits."
    );
  }

  return {
    mainNo: Number(
      value.slice(11, 15)
    ),
    subNo: Number(
      value.slice(15, 19)
    )
  };
}


function extractJibunParcel(
  jibun
) {
  const source =
    String(jibun ?? "")
      .normalize("NFKC")
      .trim();

  /*
   * korean_land_mcp의 parcel.jibun은
   * "1116 대"처럼 지번 뒤에 1자리 지목 코드가 붙을 수 있다.
   * 필지번호 검증에서는 이 지목 코드는 무시하고
   * 숫자/부번만 PNU와 비교한다.
   */
  const match =
    /^(?:산\s*)?(\d+)\s*(?:-\s*(\d+))?\s*(?:번지)?\s*([가-힣])?$/u.exec(
      source
    );

  if (!match) {
    return null;
  }

  return {
    mainNo: Number(match[1]),
    subNo: Number(match[2] ?? "0")
  };
}


function validatePnuJibunConsistency(
  pnu,
  jibun
) {
  const pnuParcel =
    parsePnuParcel(pnu);

  const jibunParcel =
    extractJibunParcel(jibun);

  if (!jibunParcel) {
    throw new Error(
      "Jibun does not contain a recognizable parcel number: " +
      String(jibun)
    );
  }

  if (
    pnuParcel.mainNo !== jibunParcel.mainNo ||
    pnuParcel.subNo !== jibunParcel.subNo
  ) {
    throw new Error(
      "PNU/jibun mismatch: PNU " +
      pnu +
      " encodes parcel " +
      pnuParcel.mainNo +
      "-" +
      pnuParcel.subNo +
      ", but jibun is " +
      jibun +
      ". PNU is the authoritative parcel target."
    );
  }

  return {
    matched: true,
    pnuParcel,
    jibunParcel
  };
}

function mapFdCode(
  fdCode
) {
  const value =
    String(
      fdCode ?? ""
    ).toUpperCase();

  /*
   * 현재 실제 브라우저 runtime에서
   * 검증된 mapping.
   *
   * DA* -> UQ160
   * CB* -> UQ150
   *
   * 검증되지 않은 fd_code는
   * 임의로 추정하지 않는다.
   */
  if (
    value.startsWith("DA")
  ) {
    return "UQ160";
  }

  if (
    value.startsWith("CB")
  ) {
    return "UQ150";
  }

  return null;
}


function buildConnectorItems(
  jiguInfo
) {
  const items = [];
  const skipped = [];

  for (
    const row
    of jiguInfo
  ) {
    const type =
      mapFdCode(
        row.fd_code
      );

    if (!type) {
      skipped.push({
        reason:
          "unsupported_fd_code",

        ...row
      });

      continue;
    }

    if (
      !row.wtnnc_sn
    ) {
      items.push({
        type,

        wtnnc_cd:
          "",

        siteCd:
          ""
      });

      continue;
    }

    items.push({
      type,

      wtnnc_cd:
        row.wtnnc_sn,

      siteCd:
        row.wtnnc_sn.slice(
          0,
          5
        )
    });
  }

  return {
    items,
    skipped
  };
}


function collectNoticeRecords(
  payload
) {
  const result = [];

  if (
    !payload ||
    typeof payload !==
      "object"
  ) {
    return result;
  }

  for (
    const [
      key,
      value
    ]
    of Object.entries(
      payload
    )
  ) {
    if (
      !key.endsWith(
        "_ntfcList"
      )
    ) {
      continue;
    }

    if (
      !Array.isArray(
        value
      )
    ) {
      continue;
    }

    for (
      const row
      of value
    ) {
      if (
        !row ||
        row.notExist ===
          "Y"
      ) {
        continue;
      }

      if (
        !row.notice_code ||
        !row.notice_no ||
        !row.org_cd
      ) {
        continue;
      }

      result.push({
        sourceKey:
          key,

        ucode_nm:
          row.ucode_nm ??
          "",

        notice_code:
          row.notice_code,

        notice_date:
          row.notice_date ??
          "",

        notice_no:
          row.notice_no,

        wtnnc_cd_p:
          row.wtnnc_cd_p ??
          "",

        wtnnc_cd:
          row.wtnnc_cd ??
          "",

        site_code:
          row.site_code ??
          "",

        organ_nm:
          row.organ_nm ??
          "",

        title:
          row.title ??
          "",

        org_cd:
          row.org_cd,

        ucode:
          row.ucode ??
          "",

        content:
          row.content ??
          ""
      });
    }
  }

  return result;
}


function uniqueNoticeRecords(
  records
) {
  const map =
    new Map();

  for (
    const record
    of records
  ) {
    /*
     * 고시 자체를 중복 제거하지만
     * relation 정보는 별도로 보존한다.
     */
    const key =
      record.notice_code;

    const current =
      map.get(
        key
      );

    if (!current) {
      map.set(
        key,
        {
          ...record,

          relations: [
            {
              sourceKey:
                record.sourceKey,

              ucode:
                record.ucode,

              ucode_nm:
                record.ucode_nm,

              wtnnc_cd:
                record.wtnnc_cd,

              wtnnc_cd_p:
                record.wtnnc_cd_p
            }
          ]
        }
      );

      continue;
    }

    current.relations.push({
      sourceKey:
        record.sourceKey,

      ucode:
        record.ucode,

      ucode_nm:
        record.ucode_nm,

      wtnnc_cd:
        record.wtnnc_cd,

      wtnnc_cd_p:
        record.wtnnc_cd_p
    });
  }

  return [
    ...map.values()
  ].sort(
    (a, b) =>
      String(
        b.notice_date
      ).localeCompare(
        String(
          a.notice_date
        )
      )
  );
}


export async function resolveUrbanPlan(
  {
    pnu,
    version,
    server
  }
) {
  if (
    !/^\d{19}$/.test(
      pnu
    )
  ) {
    throw new Error(
      "PNU must be exactly 19 digits."
    );
  }

  const publicPage =
    await getEumPublicPage(
      pnu
    );

  const mapPlan =
    await callMapPlanPnu(
      pnu,
      {
        version,
        server
      }
    );

  const jiguInfo =
    normalizeJiguInfo(
      mapPlan.json
    );

  const {
    items,
    skipped
  } =
    buildConnectorItems(
      jiguInfo
    );

  let noticePayload =
    null;

  let connector = null;

  if (
    items.length > 0
  ) {
    connector =
      await callNoticeConnector(
        items,
        {
          pageUrl:
            publicPage.url,

          cookie:
            publicPage.cookie
        }
      );

    noticePayload =
      connector.json;
  }

  const records =
    collectNoticeRecords(
      noticePayload
    );

  const notices =
    uniqueNoticeRecords(
      records
    );

  return {
    success:
      true,

    pnu,

    source:
      "EUM public web",

    publicPage: {
      status:
        publicPage.status,

      contentType:
        publicPage.contentType,

      bytes:
        publicPage.bytes
    },

    mapPlan: {
      status:
        mapPlan.status,

      jiguInfo:
        jiguInfo,

      connectorItems:
        items,

      skippedFdCodes:
        skipped
    },

    notices,

    noticeCount:
      notices.length
  };
}


export async function getDistrictPlanHistory(
  {
    pnu,
    version,
    server
  }
) {
  const resolved =
    await resolveUrbanPlan({
      pnu,
      version,
      server
    });

  return {
    success:
      true,

    pnu,

    history:
      resolved.notices.map(
        (notice) => ({
          notice_code:
            notice.notice_code,

          notice_date:
            notice.notice_date,

          notice_no:
            notice.notice_no,

          organ_nm:
            notice.organ_nm,

          title:
            notice.title,

          ucode:
            notice.ucode,

          ucode_nm:
            notice.ucode_nm,

          wtnnc_cd:
            notice.wtnnc_cd,

          relations:
            notice.relations
        })
      )
  };
}


export async function searchUrbanPlanNotice(
  {
    pnu,
    query,
    noticeNo,
    version,
    server
  }
) {
  const resolved =
    await resolveUrbanPlan({
      pnu,
      version,
      server
    });

  const q =
    String(
      query ?? ""
    )
      .trim()
      .toLowerCase();

  const n =
    String(
      noticeNo ?? ""
    )
      .trim();

  const results =
    resolved.notices.filter(
      (notice) => {
        if (
          n &&
          notice.notice_no !==
            n
        ) {
          return false;
        }

        if (!q) {
          return true;
        }

        const haystack =
          [
            notice.title,
            notice.notice_no,
            notice.notice_code,
            notice.organ_nm,
            notice.ucode_nm,
            notice.content
          ]
            .join(" ")
            .toLowerCase();

        return haystack.includes(
          q
        );
      }
    );

  return {
    success:
      true,

    pnu,

    query:
      query ?? "",

    noticeNo:
      noticeNo ?? "",

    results
  };
}


export async function getNoticeDetailForPnu(
  {
    pnu,
    noticeCode,
    version,
    server
  }
) {
  const resolved =
    await resolveUrbanPlan({
      pnu,
      version,
      server
    });

  const notice =
    resolved.notices.find(
      (item) =>
        item.notice_code ===
        noticeCode
    );

  if (!notice) {
    throw new Error(
      `Notice code not found for PNU ${pnu}: ${noticeCode}`
    );
  }

  return getNoticeDetail(
    notice
  );
}


export async function getNoticeAttachmentsForPnu(
  {
    pnu,
    noticeCode,
    download = true,
    version,
    server
  }
) {
  const detail =
    await getNoticeDetailForPnu({
      pnu,
      noticeCode,
      version,
      server
    });

  let attachments =
    detail.attachments;

  if (
    download &&
    attachments.length > 0
  ) {
    attachments =
      await storeAllAttachments(
        noticeCode,
        attachments
      );
  }

  return {
    ...detail,

    attachments
  };
}


async function analyzeNoticeRecord({
  pnu,
  jibun,
  notice,
  download = true,
  saveMatchedImages = false,
  imageOutputDir = null,
  enableOcrFallback = true,
  ocrMaxPages = 24,
  ocrScale = 2.5
}) {
  let source = await getNoticeDetail(
    notice
  );

  let attachments = source.attachments;

  if (
    download &&
    attachments.length > 0
  ) {
    attachments =
      await storeAllAttachments(
        notice.notice_code,
        attachments
      );
  }

  source = {
    ...source,
    attachments
  };

  const firstAttachmentPath =
    source.attachments.find(
      attachment =>
        attachment.filePath
    )?.filePath || null;

  const noticeDir =
    firstAttachmentPath
      ? path.dirname(
          firstAttachmentPath
        )
      : null;

  const evidenceImageDir =
    imageOutputDir ||
    (
      noticeDir
        ? path.join(
            noticeDir,
            "evidence_images"
          )
        : null
    );

  const applicability =
    await analyzeTextApplicability({
      pnu,
      jibun,
      notice:
        source.notice,
      attachments:
        source.attachments,
      noticeDir,
      enableOcrFallback,
      ocrMaxPages,
      ocrScale,
      saveMatchedImages,
      imageOutputDir:
        evidenceImageDir
    });

  const sourcePackage =
    buildSourcePackage({
      noticeCode:
        notice.notice_code,
      attachments:
        source.attachments
    });

  return {
    success:
      true,

    pnu,
    jibun,

    targetValidation:
      null,

    notice: {
      notice_code:
        source.notice.notice_code,

      notice_no:
        source.notice.notice_no,

      notice_date:
        source.notice.notice_date,

      organ_nm:
        source.notice.organ_nm,

      title:
        source.notice.title,

      org_cd:
        source.notice.org_cd,

      ucode:
        source.notice.ucode,

      ucode_nm:
        source.notice.ucode_nm,

      wtnnc_cd:
        source.notice.wtnnc_cd
    },

    applicability,

    sourcePackage,

    attachments:
      source.attachments
  };
}

export async function analyzeUrbanPlan(
  {
    pnu,
    jibun,
    noticeCode,
    download = true,
    saveMatchedImages = false,
    imageOutputDir = null,
    enableOcrFallback = true,
    ocrMaxPages = 24,
    ocrScale = 2.5,
    version,
    server
  }
) {
  if (!pnu) {
    throw new Error(
      "analyze_urban_plan requires pnu."
    );
  }

  if (!jibun) {
    throw new Error(
      "analyze_urban_plan requires jibun for parcel evidence location."
    );
  }

  const targetValidation =
    validatePnuJibunConsistency(
      pnu,
      jibun
    );

  if (!noticeCode) {
    throw new Error(
      "analyze_urban_plan requires noticeCode. First use resolve_urban_plan or get_district_plan_history to identify the notice."
    );
  }

  const resolved =
    await resolveUrbanPlan({
      pnu,
      version,
      server
    });

  const notice =
    resolved.notices.find(
      item =>
        item.notice_code ===
        noticeCode
    );

  if (!notice) {
    throw new Error(
      `Notice code not found for PNU ${pnu}: ${noticeCode}`
    );
  }

  const result =
    await analyzeNoticeRecord({
      pnu,
      jibun,
      notice,
      download,
      saveMatchedImages,
      enableOcrFallback,
      ocrMaxPages,
      ocrScale
    });

  return {
    ...result,
    targetValidation
  };
}



export async function analyzeDistrictPlanHistory({
  pnu,
  jibun,
  download = true,
  saveMatchedImages = false,
  enableOcrFallback = true,
  ocrMaxPages = 24,
  ocrScale = 2.5,
  stopOnUsableEvidence = true,
  maxRetryPages = 64,
  version,
  server
}) {
  if (!pnu) {
    throw new Error(
      "analyze_district_plan_history requires pnu."
    );
  }

  if (!jibun) {
    throw new Error(
      "analyze_district_plan_history requires jibun."
    );
  }

  const targetValidation =
    validatePnuJibunConsistency(
      pnu,
      jibun
    );

  const resolved =
    await resolveUrbanPlan({
      pnu,
      version,
      server
    });

  const history =
    Array.isArray(
      resolved.notices
    )
      ? resolved.notices
      : [];

  const noticeDetails = [];

  const hasUsableEvidence =
    detail =>
      detail?.success === true &&
      Number(
        detail
          ?.applicability
          ?.matchCount || 0
      ) > 0 &&
      Number(
        detail
          ?.sourcePackage
          ?.preservedOriginalCount || 0
      ) > 0;

  const getRetryMaxPages =
    detail => {
      if (
        Number(
          detail
            ?.sourcePackage
            ?.preservedOriginalCount || 0
        ) <= 0
      ) {
        return null;
      }

      const skippedReasons =
        Array.isArray(
          detail
            ?.applicability
            ?.ocrSummary
            ?.skippedReasons
        )
          ? detail
              .applicability
              .ocrSummary
              .skippedReasons
          : [];

      if (
        !skippedReasons.includes(
          "large_pdf_over_page_limit"
        )
      ) {
        return null;
      }

      const pageCounts =
        Array.isArray(
          detail
            ?.applicability
            ?.sources
        )
          ? detail
              .applicability
              .sources
              .map(
                source =>
                  Number(
                    source?.pageCount || 0
                  )
              )
              .filter(
                value =>
                  Number.isInteger(
                    value
                  ) &&
                  value >
                    ocrMaxPages &&
                  value <=
                    maxRetryPages
              )
          : [];

      return pageCounts.length > 0
        ? Math.max(
            ...pageCounts
          )
        : null;
    };

  for (
    const notice
    of history
  ) {
    if (
      !notice?.notice_code
    ) {
      continue;
    }

    try {
      let detail =
        await analyzeNoticeRecord({
          pnu,
          jibun,
          notice,
          download,
          saveMatchedImages,
          enableOcrFallback,
          ocrMaxPages,
          ocrScale
        });

      let ocrRetry = null;

      const retryMaxPages =
        getRetryMaxPages(
          detail
        );

      if (
        !hasUsableEvidence(
          detail
        ) &&
        retryMaxPages
      ) {
        ocrRetry = {
          attempted:
            true,
          reason:
            "large_pdf_over_page_limit",
          initialMaxPages:
            ocrMaxPages,
          retryMaxPages
        };

        detail =
          await analyzeNoticeRecord({
            pnu,
            jibun,
            notice,
            download,
            saveMatchedImages,
            enableOcrFallback,
            ocrMaxPages:
              retryMaxPages,
            ocrScale
          });
      }

      noticeDetails.push({
        noticeCode:
          notice.notice_code,
        notice,
        detail,
        ocrRetry
      });

      if (
        stopOnUsableEvidence &&
        hasUsableEvidence(
          detail
        )
      ) {
        break;
      }
    } catch (error) {
      noticeDetails.push({
        noticeCode:
          notice.notice_code,
        notice,
        error:
          error?.message ||
          String(error)
      });
    }
  }

  const evidenceResults =
    noticeDetails
      .map(
        item =>
          item?.detail
      )
      .filter(
        detail =>
          hasUsableEvidence(
            detail
          )
      );

  const analysisFailures =
    noticeDetails
      .filter(
        item =>
          !hasUsableEvidence(
            item?.detail
          )
      )
      .map(
        item => ({
          noticeCode:
            item.noticeCode,
          error:
            item?.detail?.error ||
            item?.detail
              ?.applicability
              ?.status ||
            "URBAN_ANALYSIS_NO_USABLE_EVIDENCE",
          message:
            item?.detail?.message ||
            null
        })
      );

  const analysisAttemptedCount =
    noticeDetails.length;

  const analysisSuccessCount =
    evidenceResults.length;

  let analysisStatus =
    "NOT_RUN";

  if (
    analysisAttemptedCount > 0
  ) {
    if (
      analysisSuccessCount ===
      analysisAttemptedCount
    ) {
      analysisStatus =
        "SUCCESS";
    } else if (
      analysisSuccessCount > 0
    ) {
      analysisStatus =
        "PARTIAL";
    } else {
      analysisStatus =
        "FAILED";
    }
  }

  return {
    success:
      true,

    pnu,
    jibun,

    targetValidation,

    history,

    noticeDetails,

    evidenceResults,

    analysisFailures,

    analysisAttemptedCount,

    analysisSuccessCount,

    analysisStatus,

    stopOnUsableEvidence,

    maxRetryPages
  };
}
