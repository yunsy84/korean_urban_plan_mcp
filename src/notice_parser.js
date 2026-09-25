import {
  findEumDetailPages
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

function parseJavascriptDownload(
  href
) {
  const decoded =
    decodeHtmlEntities(
      href
    ).trim();

  const match =
    /^javascript\s*\\?\s*:\s*download\s*\(\s*(['"])(.*?)\1\s*,\s*(['"])([\s\S]*?)\3\s*\)\s*;?$/i.exec(
      decoded
    );

  if (!match) {
    return null;
  }

  return {
    endpoint:
      match[2],
    file:
      match[4]
  };
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

  const source =
    String(
      html ?? ""
    )
      .replace(
        /<!--(?:[\s\S]*?)-->/g,
        ""
      );

  const regex =
    /<a\b([^>]*?)\bhref\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;

  let match;

  while (
    (match =
      regex.exec(source)) !==
    null
  ) {
    const rawHref =
      decodeHtmlEntities(
        match[3]
      ).trim();

    const download =
      parseJavascriptDownload(
        rawHref
      );

    if (download) {
      const resultItem = {
        href:
          null,

        download,

        text:
          stripHtml(
            match[5]
          ),

        attrs:
          `${match[1]} ${match[4]}`
      };

      Object.defineProperty(
        resultItem,
        "_download",
        {
          value: download,
          enumerable: false,
          writable: false,
          configurable: false
        }
      );

      result.push(
        resultItem
      );

      continue;
    }
    const href =
      absoluteUrl(
        baseUrl,
        rawHref
      );

    if (!href) {
      continue;
    }

    result.push({
      href,

      download:
        null,

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
    /\.hwp(?:[?#]|$)/i.test(
      url
    ) ||
    /\bhwp\b/i.test(
      combined
    )
  ) {
    return "hwp";
  }

  if (
    /\.hwpx(?:[?#]|$)/i.test(
      url
    ) ||
    /\bhwpx\b/i.test(
      combined
    )
  ) {
    return "hwpx";
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
  baseUrl,
  {
    cookie = ""
  } = {}
) {
  const anchors =
    extractAnchors(
      html,
      baseUrl
    );

  const result = [];
  const seen =
    new Set();

  let detailSeq =
    null;

  try {
    detailSeq =
      new URL(
        baseUrl
      ).searchParams.get(
        "seq"
      );
  } catch {
    detailSeq =
      null;
  }

  for (
    const anchor
    of anchors
  ) {
    let url =
      anchor.href;

    let kindTarget =
      anchor.href ||
      "";

    let request =
      null;

    if (
      anchor.download
    ) {
      url =
        absoluteUrl(
          baseUrl,
          anchor.download.endpoint
        );

      if (!url) {
        continue;
      }

      kindTarget =
        anchor.download.file;

      const form =
        new URLSearchParams();

      form.set(
        "gosi",
        "Y"
      );

      if (detailSeq) {
        form.set(
          "seq",
          detailSeq
        );
      }

      form.set(
        "file",
        anchor.download.file
      );

      request = {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",

          Origin:
            "https://www.eum.go.kr",

          Referer:
            baseUrl,

          ...(cookie
            ? {
                Cookie:
                  cookie
              }
            : {})
        },

        body:
          form.toString()
      };
    }

    const isDownload =
      Boolean(
        anchor.download
      ) ||
      /DownloadBig\.jsp/i.test(
        anchor.href || ""
      ) ||
      /DownloadZip\.jsp/i.test(
        anchor.href || ""
      ) ||
      /\/download(?:\b|\?)/i.test(
        anchor.href || ""
      ) ||
      /\.(pdf|jpe?g|png|gif|bmp|webp|zip)(?:[?#]|$)/i.test(
        anchor.href || ""
      ) ||
      /\.(pdf|jpe?g|png|gif|bmp|webp|zip)\b/i.test(
        anchor.text || ""
      );

    if (!isDownload || !url) {
      continue;
    }

    const key =
      request
        ? `POST|${url}|${anchor.download.file}`
        : `GET|${url}`;

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    result.push({
      kind:
        classifyAttachment(
          kindTarget,
          anchor.text
        ),

      displayName:
        anchor.text ||
        null,

      url,

      ...(request
        ? {
            _download:
              request
          }
        : {})
    });
  }

  return result;
}

export async function getNoticeDetail(
  notice
) {
  const discovered =
    await findEumDetailPages(
      notice
    );

  const details =
    Array.isArray(
      discovered?.details
    )
      ? discovered.details
      : [];

  if (
    details.length === 0
  ) {
    throw new Error(
      "EUM detail seq was not discovered for notice " +
      String(
        notice?.notice_code ??
        notice?.notice_no ??
        ""
      ) +
      ". " +
      "The detail seq must come from the EUM gosi list; " +
      "it must not be derived from wtnnc_cd."
    );
  }

  const attachments =
    [];

  const seen =
    new Set();

  for (
    const page
    of details
  ) {
    const found =
      extractAttachmentCandidates(
        page.html,
        page.url,
        {
          cookie:
            page.cookie
        }
      );

    for (
      const attachment
      of found
    ) {
      const key =
        attachment._download
          ? (
              "POST|" +
              attachment.url +
              "|" +
              attachment._download.body
            )
          : (
              "GET|" +
              attachment.url
            );

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);

      attachments.push({
        ...attachment,
        detailSeq:
          page.seq,
        detailUrl:
          page.url
      });
    }
  }

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
        details.length === 1
          ? details[0].url
          : null,

      status:
        details.every(
          item =>
            item.status >= 200 &&
            item.status < 400
        )
          ? 200
          : details[0].status,

      contentType:
        details[0].contentType,

      encoding:
        details[0].encoding,

      bytes:
        details.reduce(
          (sum, item) =>
            sum +
            Number(
              item.bytes || 0
            ),
          0
        ),

      seqs:
        details.map(
          item =>
            item.seq
        ),

      sources:
        details.map(
          item => ({
            seq:
              item.seq,

            url:
              item.url,

            status:
              item.status,

            contentType:
              item.contentType,

            encoding:
              item.encoding,

            bytes:
              item.bytes
          })
        )
    },

    attachments
  };
}