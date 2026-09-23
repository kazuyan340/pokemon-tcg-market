// movers-up.html / movers-down.html で共有するスクリプト。bodyのdata-direction属性
// ("up"または"down")で挙動を出し分ける(HTMLはほぼ同一なので1ファイルで両対応)。
const DIRECTION = document.body.dataset.direction;
let moversRes = {};
let cardById = new Map();
let siteTabs;

async function init() {
  const [allCards, moversData] = await Promise.all([
    loadCardData(),
    fetchFresh("data/movers.json").then((r) => r.json()),
  ]);
  cardById = new Map(allCards.map((c) => [c.id, c]));
  moversRes = moversData;

  bindModalEvents();
  bindNavMenuToggle();
  siteTabs = createSiteTabController("site-tabs", renderAll);
  renderAll();
  renderLastUpdated();
}

function renderAll() {
  const site = siteTabs.getSite();
  const items = bySite(moversRes[DIRECTION], site);
  renderTrendCardGrid("mover-grid", "mover-empty", items, cardById, trendBadgeLines, DIRECTION);
}

init();
