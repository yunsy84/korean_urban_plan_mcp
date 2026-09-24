import {
  buildNoticeDetailUrl,
  fetchEumDetailPage
} from "./eum_source_client.js";

function decodeHtmlEntities(
  value
) {
  return String(value ?? "")
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      "\""
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /&nbsp;/gi,
      " "
    );
}

function absoluteUrl(
  base,
  href
) {
  const decoded =
    decodeHtmlEntities(
      href
    ).trim();

  if (!decoded) {
    return null;
  }

  if (
    /^javascript:/i.test(
      decoded
    )
  ) {
    return null;
  }

  if (
    decoded.startsWith("#")
  ) {
    return null;
  }

  try {
    return new URL(
      decoded,
      base
    ).toString();
  } catch {
    return null;
  }
}

function stripHtml(
  value
) {
  return decodeHtmlEntities(
    String(value ?? "")
      .replace(
        /<[^>]+>/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim()
  );
}

function extractAnchors(
  html,
  baseUrl
) {
  const result = [];

  const regex =
    /<a\b([^>]*?)\bhref\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match =
      regex.exec(html)) !==
    null
  ) {
    const href =
      absoluteUrl(
        baseUrl,
        match[3]
      );

    if (!href) {
      continue;
    }

    result.push({
      href,

      text:
        stripHtml(
          match[5]
        ),

      attrs:
        `${match[1]} ${match[4]}`
    });
  }

  return result;
}

function classifyAttachment(
  url,
  text
) {
  const combined =
    `${url} ${text}`
      .toLowerCase();

  if (
    /DownloadZip\.jsp/i.test(
      url
    ) ||
    /\bzip\b/i.test(
      combined
    )
  ) {
    return "zip";
  }

  if (
    /\.pdf(?:[?#]|$)/i.test(
      url
    ) ||
    /\bpdf\b/i.test(
      combined
    )
  ) {
    return "pdf";
  }

  if (
    /\.(jpe?g|png|gif|bmp|webp)(?:[?#]|$)/i.test(
      url
    ) ||
    /\.(jpe?g|png|gif|bmp|webp)\b/i.test(
      combined
    )
  ) {
    return "image";
  }

  return "other";
}

export function extractAttachmentCandidates(
  html,
  baseUrl
) {
  const anchors =
    extractAnchors(
      html,
      baseUrl
    );

  const result = [];
  const seen =
    new Set();

  for (
    const anchor
    of anchors
  ) {
    const isDownload =
      /DownloadBig\.jsp/i.test(
        anchor.href
      ) ||
      /DownloadZip\.jsp/i.test(
        anchor.href
      ) ||
      /\/download(?:\b|\?)/i.test(
        anchor.href
      ) ||
      /\.(pdf|jpe?g|png|gif|bmp|webp|zip)(?:[?#]|$)/i.test(
        anchor.href
      );

    if (!isDownload) {
      continue;
    }

    if (
      seen.has(
        anchor.href
      )
    ) {
      continue;
    }

    seen.add(
      anchor.href
    );

    result.push({
      kind:
        classifyAttachment(
          anchor.href,
          anchor.text
        ),

      displayName:
        anchor.text ||
        null,

      url:
        anchor.href
    });
  }

  return result;
}

export async function getNoticeDetail(
  notice
) {
  const detailUrl =
    buildNoticeDetailUrl(
      notice
    );

  const page =
    await fetchEumDetailPage(
      detailUrl
    );

  const attachments =
    extractAttachmentCandidates(
      page.html,
      detailUrl
    );

  return {
    success:
      true,

    notice: {
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

      org_cd:
        notice.org_cd,

      ucode:
        notice.ucode,

      ucode_nm:
        notice.ucode_nm,

      wtnnc_cd:
        notice.wtnnc_cd,

      sourceKey:
        notice.sourceKey
    },

    detail: {
      url:
        detailUrl,

      status:
        page.status,

      contentType:
        page.contentType,

      encoding:
        page.encoding,

      bytes:
        page.bytes
    },

    attachments
  };
}