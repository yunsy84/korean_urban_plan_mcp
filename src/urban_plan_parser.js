import * as cheerio from 'cheerio';

export function parsePnuAnalysis(data) {
  const jiguInfo = Array.isArray(data?.jigu_info) ? data.jigu_info : [];
  return {
    success: true,
    count: jiguInfo.length,
    items: jiguInfo.map(item => ({
      type: item.type ?? null,
      wtnnc_sn: item.wtnnc_sn ?? null,
      fd_code: item.fd_code ?? null,
      fd_name: item.fd_name ?? item.ucode_nm ?? null,
      raw: item
    }))
  };
}

export function parseRecentNoticeHtml(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const rows = [];
  $('table tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').map((__, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    if (cells.length) rows.push(cells);
  });
  return {
    success: true,
    title: $('.tit').first().text().replace(/\s+/g, ' ').trim() || null,
    rows,
    text: $.root().text().replace(/\s+/g, ' ').trim()
  };
}

export function parseNoticeDetailHtml(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const title = $('h1,h2,h3,.tit,.view_tit').first().text().replace(/\s+/g, ' ').trim() || null;
  const text = $.root().text().replace(/\s+/g, ' ').trim();
  return { success: true, title, text };
}
