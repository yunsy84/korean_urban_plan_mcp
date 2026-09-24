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
  locatePdfEvidence,
  locateImageEvidence
} from "./evidence_locator.js";


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


export async function analyzeUrbanPlan(
  {
    pnu,
    jibun,
    noticeCode,
    download = true,
    saveMatchedImages = false,
    imageOutputDir = null,
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

  if (!noticeCode) {
    throw new Error(
      "analyze_urban_plan requires noticeCode. First use resolve_urban_plan or get_district_plan_history to identify the notice."
    );
  }

  const source =
    await getNoticeAttachmentsForPnu({
      pnu,
      noticeCode,
      download,
      version,
      server
    });

  const evidence = [];

  for (
    const attachment
    of source.attachments
  ) {
    if (
      !attachment.filePath
    ) {
      evidence.push({
        source:
          attachment.displayName,

        kind:
          attachment.kind,

        status:
          "download_not_performed"
      });

      continue;
    }

    if (
      attachment.magic ===
        "pdf" ||
      attachment.kind ===
        "pdf"
    ) {
      const result =
        await locatePdfEvidence(
          attachment.filePath,
          {
            jibun,
            saveMatchedImages,
            imageOutputDir
          }
        );

      evidence.push({
        ...result,

        sourceAttachment:
          attachment.displayName
      });

      continue;
    }

    if (
      attachment.magic ===
        "png" ||
      attachment.magic ===
        "jpeg" ||
      attachment.kind ===
        "image"
    ) {
      const result =
        await locateImageEvidence(
          attachment.filePath,
          {
            jibun
          }
        );

      evidence.push({
        ...result,

        sourceAttachment:
          attachment.displayName
      });

      continue;
    }

    /*
     * ZIP은 다운로드된 원본만 확보하고
     * 내부 내용을 여기서 임의로 요약하지 않는다.
     */
    evidence.push({
      sourceAttachment:
        attachment.displayName,

      kind:
        attachment.kind,

      magic:
        attachment.magic,

      status:
        "source_file_downloaded"
    });
  }

  return {
    success:
      true,

    pnu,

    jibun,

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
        source.notice.title
    },

    attachments:
      source.attachments,

    evidence
  };
}