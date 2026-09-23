// 公式サイトのカード一覧APIに載っていないカード(ショップの商品一覧から逆輸入した
// もの)だけを一覧表示する管理用ページ。data/unofficial-cards.json (通常のcards.json
// とは別出力、data_source列を含むフル情報)を読み込む。

async function init() {
  const [cardsRes, pricesRes, unresolvedRes] = await Promise.all([
    fetchFresh("data/unofficial-cards.json"),
    fetchFresh("data/prices_latest.json"),
    fetchFresh("data/unresolved-shop-items.json"),
    loadSiteMeta(),
  ]);
  const cards = await cardsRes.json();
  commonPrices = await pricesRes.json();

  bindModalEvents();
  renderLastUpdated();
  render(cards);
  bindManualResolutionControls();

  const unresolved = await unresolvedRes.json();
  renderUnresolved(unresolved);
}

function render(cards) {
  const grid = document.getElementById("card-grid");
  grid.innerHTML = "";
  document.getElementById("result-count").textContent = `${cards.length}件`;

  for (const card of cards) {
    const tile = createCardTile(card);

    const badge = document.createElement("div");
    badge.className = "admin-source-badge";
    badge.textContent = card.data_source || "";
    tile.appendChild(badge);

    grid.appendChild(tile);
  }
}

// 価格を「1,234円」または(複数件あれば)「1,234円〜5,678円」の形にする。
function formatPriceRange(prices) {
  if (!prices || prices.length === 0) return "価格不明";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `${min.toLocaleString()}円` : `${min.toLocaleString()}円〜${max.toLocaleString()}円`;
}

// item.site(出品元)ごとに、data/*.jsonへの書き出し順(=元の監査順)を保った
// まま束ねる。Map挿入順は最初に出てきたサイトの順序で保たれる。
function groupBySite(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.site)) groups.set(item.site, []);
    groups.get(item.site).push(item);
  }
  return groups;
}

// サイト名 -> そのショップでitemを検索するURLを作る関数。common.jsの
// SITE_LINK_BUILDERSと同じ関数を再利用する(通常の価格比較表のリンクと同じ仕組み)。
// カード名で検索するサイト(トレカバース/わいTV/メルカード)はitem.product_name
// (商品名からレアリティ等より前の部分を機械的に切り出したもの、無ければraw_key)を使う。
const UNRESOLVED_SEARCH_URL_BUILDERS = {
  "トレカバース": (item) => torecabirthSearchUrl(item.product_name || item.raw_key, item.rarity, item.raw_key),
  "わいTV": (item) => waitvSearchUrl(item.product_name || item.raw_key, item.rarity, item.raw_key),
  "メルカード": (item) => mercardSearchUrl(item.product_name || item.raw_key, item.rarity, item.raw_key),
  "カードラボ": (item) => cardLaboSearchUrl(item.raw_key),
  "竜のしっぽ": (item) => ryuunoshippoSearchUrl(item.raw_key),
  "フルアヘッド": (item) => fullaheadSearchUrl(item.raw_key),
  "まんぞく屋": (item) => manzokuyaSearchUrl(item.raw_key),
  "駿河屋": (item) => surugaAffiliateUrl(item.raw_key),
};

function searchUrlFor(item) {
  const builder = UNRESOLVED_SEARCH_URL_BUILDERS[item.site];
  return builder ? builder(item) : null;
}

// missing(候補が1件も無い)側の1行。選択の余地が無いので従来通り
// (raw_key, rarity)単位で価格範囲・件数をまとめたまま表示する。
function renderMissingRow(item) {
  const url = searchUrlFor(item);
  const row = document.createElement("div");
  row.className = "unresolved-row";

  const thumbLink = document.createElement("a");
  thumbLink.className = "unresolved-thumb";
  if (url) {
    thumbLink.href = url;
    thumbLink.target = "_blank";
    thumbLink.rel = "noopener";
  }
  if (item.image_url) {
    const img = document.createElement("img");
    img.src = item.image_url;
    img.alt = "";
    img.loading = "lazy";
    thumbLink.appendChild(img);
  } else {
    thumbLink.classList.add("unresolved-thumb-empty");
    thumbLink.textContent = "🔍";
  }
  row.appendChild(thumbLink);

  const info = document.createElement("div");
  info.className = "unresolved-row-info";

  const listingNote = item.listing_count > 1 ? `(${item.listing_count}件の出品)` : "";
  const titleText = item.product_name || item.raw_key;
  const titleHtml = url
    ? `<a href="${url}" target="_blank" rel="noopener">${escapeHtml(titleText)}</a>`
    : escapeHtml(titleText);
  info.innerHTML = `<div class="unresolved-row-title">
      ${titleHtml}
      <code>${escapeHtml(item.raw_key)}</code>${item.rarity ? ` <span class="unresolved-rarity">${escapeHtml(item.rarity)}</span>` : ""}
      <span class="unresolved-price">${escapeHtml(formatPriceRange(item.prices))}${listingNote}</span>
    </div>`;

  if (item.hint) {
    const hint = document.createElement("div");
    hint.className = "unresolved-hint";
    hint.textContent = item.hint;
    info.appendChild(hint);
  }

  row.appendChild(info);
  return row;
}

// ambiguous(候補は絞れたが1枚に特定できない)側は、同じ(raw_key, rarity)の
// 出品同士でも実際には違う物理カードのことがあるため、出品ごとに個別の
// サムネイル・リンク・候補ピッカーを持たせる。見出し(候補一覧)だけは
// (raw_key, rarity)単位でまとめてコンパクトにする。
function renderAmbiguousGroup(item) {
  const wrap = document.createElement("div");
  wrap.className = "unresolved-group";

  const heading = document.createElement("div");
  heading.className = "unresolved-candidates";
  heading.textContent = `${item.raw_key}${item.rarity ? ` ${item.rarity}` : ""} 区別できていない候補: ${item.candidates.map((c) => `${c.card_num}(${c.name})${c.pack ? `[${c.pack}]` : ""}`).join(" / ")}`;
  wrap.appendChild(heading);

  item.listings.forEach((listing, index) => {
    wrap.appendChild(renderAmbiguousListingRow(item, listing, index));
  });

  return wrap;
}

function renderAmbiguousListingRow(item, listing, index) {
  const url = listing.product_url || searchUrlFor({ ...item, product_name: listing.product_name });
  const row = document.createElement("div");
  row.className = "unresolved-row unresolved-listing-row";

  const thumbLink = document.createElement("a");
  thumbLink.className = "unresolved-thumb";
  if (url) {
    thumbLink.href = url;
    thumbLink.target = "_blank";
    thumbLink.rel = "noopener";
  }
  if (listing.image_url) {
    const img = document.createElement("img");
    img.src = listing.image_url;
    img.alt = "";
    img.loading = "lazy";
    thumbLink.appendChild(img);
  } else {
    thumbLink.classList.add("unresolved-thumb-empty");
    thumbLink.textContent = "🔍";
  }
  row.appendChild(thumbLink);

  const info = document.createElement("div");
  info.className = "unresolved-row-info";

  const titleText = listing.product_name || item.raw_key;
  const titleHtml = url
    ? `<a href="${url}" target="_blank" rel="noopener">${escapeHtml(titleText)}</a>`
    : escapeHtml(titleText);
  info.innerHTML = `<div class="unresolved-row-title">
      ${titleHtml}
      <span class="unresolved-price">${escapeHtml(formatPriceRange(listing.price != null ? [listing.price] : []))}</span>
    </div>`;

  info.appendChild(renderCandidatePicker(item, listing, index));

  if (listing.hint) {
    const hint = document.createElement("div");
    hint.className = "unresolved-hint";
    hint.textContent = listing.hint;
    info.appendChild(hint);
  }

  row.appendChild(info);
  return row;
}

// 手動確定の選択は、このサイトには保存先(サーバー)が無いのでブラウザの
// localStorageに置くだけにする。ユーザーがエクスポートしたJSONをClaudeに渡し、
// scraper_prices_*.pyの手動確定リストへ組み込んでもらう運用。
const MANUAL_RESOLUTION_KEY = "pokemon_manual_resolutions_v1";

function loadManualResolutions() {
  try {
    return JSON.parse(localStorage.getItem(MANUAL_RESOLUTION_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveManualResolutions(map) {
  localStorage.setItem(MANUAL_RESOLUTION_KEY, JSON.stringify(map));
}

// 出品ごとに一意なキー。product_urlがあればそれで(Python側のload_manual_resolutions
// はproduct_urlでマッチする)。CardLabo等、まだproduct_urlを出していないサイトの
// 出品に対しては、この端末内だけで一意になるフォールバックキーを使う
// (エクスポート後にPython側で使うにはそのサイトのスクレイパーにもproduct_url
// 対応が必要)。
function resolutionKeyFor(item, listing, index) {
  if (listing && listing.product_url) return listing.product_url;
  return `${item.site}|${item.raw_key}|${item.rarity || ""}|${index}`;
}

function updateManualResolutionCount() {
  const el = document.getElementById("manual-resolution-count");
  if (!el) return;
  const count = Object.keys(loadManualResolutions()).length;
  el.textContent = `${count}件選択済み`;
}

// 候補画像をクリックして選べるピッカーを出品1件分作る。選択はlocalStorageに保存する
// だけで、この場では何も自動反映しない(サイト側にサーバーが無いため)。同じ
// (raw_key, rarity)でも出品ごとに別の物理カードのことがあるため、キーは
// この出品固有(product_url、無ければフォールバック)にする。
function renderCandidatePicker(item, listing, index) {
  const key = resolutionKeyFor(item, listing, index);
  const picker = document.createElement("div");
  picker.className = "unresolved-picker";

  const grid = document.createElement("div");
  grid.className = "unresolved-picker-grid";

  const resolutions = loadManualResolutions();
  const chosenCardNum = resolutions[key] ? resolutions[key].card_num : null;

  for (const c of item.candidates) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "unresolved-picker-item" + (chosenCardNum === c.card_num ? " selected" : "");
    btn.title = `${c.card_num} ${c.name}${c.pack ? ` / ${c.pack}` : ""}`;
    btn.innerHTML = `<img src="${c.image_url || ""}" alt="" loading="lazy"><span>${escapeHtml(c.card_num)}</span>${c.pack ? `<span class="unresolved-picker-pack">${escapeHtml(c.pack)}</span>` : ""}`;
    btn.addEventListener("click", () => {
      const current = loadManualResolutions();
      current[key] = {
        product_url: listing.product_url || null,
        site: item.site, raw_key: item.raw_key, rarity: item.rarity,
        card_id: c.id, card_num: c.card_num, name: c.name,
      };
      saveManualResolutions(current);
      grid.querySelectorAll(".unresolved-picker-item").forEach((el) => el.classList.remove("selected"));
      btn.classList.add("selected");
      updateManualResolutionCount();
    });
    grid.appendChild(btn);
  }
  picker.appendChild(grid);
  return picker;
}

function exportManualResolutions() {
  const resolutions = loadManualResolutions();
  const list = Object.values(resolutions);
  const blob = new Blob([JSON.stringify(list, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "manual_resolutions.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function bindManualResolutionControls() {
  updateManualResolutionCount();
  document.getElementById("export-manual-resolutions").addEventListener("click", exportManualResolutions);
  document.getElementById("clear-manual-resolutions").addEventListener("click", () => {
    if (!confirm("この端末に保存した選択を全て消します。よろしいですか？")) return;
    localStorage.removeItem(MANUAL_RESOLUTION_KEY);
    renderUnresolved(window.__unresolvedData || { ambiguous: [], missing: [] });
  });
}

// サイトごとの見出し+行リストを作る。renderRowで1グループ(または1件)分の
// DOMを作る関数を差し替えられるようにして、ambiguous(出品ごとの候補ピッカー付き
// グループ)とmissing(候補無しの単純な集約行)の両方で共用する。
function renderUnresolvedGroup(containerId, countId, items, renderRow, countOf) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  const totalCount = countOf ? items.reduce((sum, item) => sum + countOf(item), 0) : items.length;
  document.getElementById(countId).textContent = `${totalCount}件`;

  for (const [site, siteItems] of groupBySite(items)) {
    const siteCount = countOf ? siteItems.reduce((sum, item) => sum + countOf(item), 0) : siteItems.length;
    const siteHeading = document.createElement("h4");
    siteHeading.className = "unresolved-site-heading";
    siteHeading.textContent = `${site}(${siteCount}件)`;
    container.appendChild(siteHeading);

    for (const item of siteItems) {
      container.appendChild(renderRow(item));
    }
  }
}

function renderUnresolved(data) {
  window.__unresolvedData = data;
  renderUnresolvedGroup(
    "ambiguous-list", "ambiguous-count", data.ambiguous || [],
    renderAmbiguousGroup, (item) => item.listings.length,
  );
  renderUnresolvedGroup("missing-list", "missing-count", data.missing || [], renderMissingRow);
  updateManualResolutionCount();
}

init();
