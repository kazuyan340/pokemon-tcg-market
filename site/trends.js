// 「価格の動き」ページ。直近上昇/上昇傾向/直近下降/下降傾向の4セクションを表示する。
// 値上がり/値下がりは別ページ(movers-up.html/movers-down.html)に分離してある
// (以前は1つのHTMLの中で3ビューをdisplay切り替えしていたが、他ページと構成を
// 揃えるために分割した)。サイトタブ(全体/駿河屋/カードラボ/竜のしっぽ/メルカード/
// フルアヘッド)はcommon.jsのcreateSiteTabControllerを使う。
let trendsRes = {};
let cardById = new Map();
let siteTabs;

async function init() {
  const [allCards, trendsData] = await Promise.all([
    loadCardData(),
    fetchFresh("data/trends.json").then((r) => r.json()),
  ]);
  cardById = new Map(allCards.map((c) => [c.id, c]));
  trendsRes = trendsData;

  bindModalEvents();
  bindNavMenuToggle();
  siteTabs = createSiteTabController("site-tabs", renderAll);
  renderAll();
  renderLastUpdated();
}

function renderAll() {
  const site = siteTabs.getSite();
  renderTrendCardGrid("recent-up-grid", "recent-up-empty", bySite(trendsRes.recent_up, site), cardById, trendBadgeLines, "up");
  renderTrendCardGrid("trend-up-grid", "trend-up-empty", bySite(trendsRes.trend_up, site), cardById, trendBadgeLines, "up");
  renderTrendCardGrid("recent-down-grid", "recent-down-empty", bySite(trendsRes.recent_down, site), cardById, trendBadgeLines, "down");
  renderTrendCardGrid("trend-down-grid", "trend-down-empty", bySite(trendsRes.trend_down, site), cardById, trendBadgeLines, "down");
}

init();
