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

  const match =
    /(\d+)\s*(?:-\s*(\d+))?\s*(?:번지)?$/u.exec(
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

  const detailSequences = [
    notice.wtnnc_cd,
    ...(Array.isArray(
      notice.relations
    )
      ? notice.relations.map(
          (relation) =>
            relation.wtnnc_cd
        )
      : [])
  ]
    .map(
      (value) =>
        String(
          value ?? ""
        ).trim()
    )
    .filter(Boolean);

  const uniqueSequences = [
    ...new Set(
      detailSequences
    )
  ];

  const sequenceNotices =
    uniqueSequences.length > 0
      ? uniqueSequences.map(
          (seq) => ({
            ...notice,
            seq,
            wtnnc_cd:
              seq
          })
        )
      : [notice];

  const detailResults = [];

  for (
    const sequenceNotice
    of sequenceNotices
  ) {
    detailResults.push(
      await getNoticeDetail(
        sequenceNotice
      )
    );
  }

  const attachments = [];
  const seenAttachmentUrls =
    new Set();

  for (
    const detailResult
    of detailResults
  ) {
    for (
      const attachment
      of Array.isArray(
        detailResult.attachments
      )
        ? detailResult.attachments
        : []
    ) {
      const key =
        String(
          attachment.url ?? ""
        ).trim();

      if (
        !key ||
        seenAttachmentUrls.has(
          key
        )
      ) {
        continue;
      }

      seenAttachmentUrls.add(
        key
      );

      attachments.push({
        ...attachment,
        detailSeq:
          detailResult.notice?.seq ??
          null
      });
    }
  }

  return {
    ...detailResults[0],
    attachments,
    detailSources:
      detailResults.map(
        (detailResult) => ({
          seq:
            detailResult.notice?.seq ??
            null,
          url:
            detailResult.detail?.url ??
            null,
          status:
            detailResult.detail?.status ??
            null,
          bytes:
            detailResult.detail?.bytes ??
            null,
          attachmentCount:
            Array.isArray(
              detailResult.attachments
            )
              ? detailResult.attachments.length
              : 0
        })
      )
  };
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

  const source =
    await getNoticeAttachmentsForPnu({
      pnu,
      noticeCode,
      download,
      version,
      server
    });

  const applicability =
    await analyzeTextApplicability({
      pnu,
      jibun,
      notice:
        source.notice,
      attachments:
        source.attachments,
      noticeDir:
        path.dirname(
          source.attachments.find(
            attachment =>
              attachment.filePath
          )?.filePath ||
          ""
        )
    });

  const sourcePackage =
    buildSourcePackage({
      noticeCode,
      attachments:
        source.attachments
    });

  return {
    success:
      true,

    pnu,

    jibun,

    targetValidation,

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

    applicability,

    sourcePackage,

    /*
     * 원자료는 전체 보존한다.
     * 오래된 결정도/지형도면 자체를
     * OCR로 필지 판독해야 한다고 가정하지 않는다.
     */
    attachments:
      source.attachments
  };
}