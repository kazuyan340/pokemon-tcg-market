// 旧裏カードページ。通常のカード図鑑(cards.json)とは別データソース(kyuura.json)を
// 読み込む、完全に独立したシンプルな一覧ページ。フィルタはキーワード検索と
// 「在庫ありのみ表示」チェックボックスのみ(凝った絞り込みは不要)。

let allGroups = [];
let filteredGroups = [];

const grid = document.getElementById("card-grid");
const resultCount = document.getElementById("result-count");
const keywordInput = document.getElementById("keyword");
const stockOnlyCheckbox = document.getElementById("stock-only");

async function init() {
  bindNavMenuToggle();
  const res = await fetchFresh("data/kyuura.json");
  allGroups = await res.json();
  bindEvents();
  applyFilters();
  renderLastUpdated();
}

function bindEvents() {
  keywordInput.addEventListener("input", debounce(applyFilters, 200));
  stockOnlyCheckbox.addEventListener("change", applyFilters);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function applyFilters() {
  const keyword = keywordInput.value.trim().toLowerCase();
  const stockOnly = stockOnlyCheckbox.checked;

  filteredGroups = allGroups.filter((g) => {
    if (stockOnly && !g.has_stock) return false;
    if (keyword && !String(g.name || "").toLowerCase().includes(keyword)) return false;
    return true;
  });

  resultCount.textContent = `${filteredGroups.length} 件ヒット`;
  renderResults();
}

// カードラッシュポケモンの商品ページへの直リンク購入ボタン。既存のmercari/amazon/rakuten
// ボタンと同じ見た目のクラスを使い回してデザインを揃える。
function kyuuraBuyButtonHtml(listing) {
  if (!listing.product_url || !listing.in_stock) return "";
  const label = listing.condition ? `状態${listing.condition}` : "在庫";
  return `<a class="mercari-check-btn" href="${listing.product_url}" target="_blank" rel="nofollow noopener">🛒 ${escapeHtml(label)} ${listing.price ? listing.price.toLocaleString() + "円" : ""}で購入する</a>`;
}

function conditionRowHtml(listing) {
  const label = listing.condition ? `状態${escapeHtml(listing.condition)}` : "状態不問";
  const priceText = listing.price !== null ? `${listing.price.toLocaleString()}円` : "-";
  const stockText = listing.in_stock ? "在庫あり" : "売り切れ";
  const stockClass = listing.in_stock ? "kyuura-in-stock" : "kyuura-sold-out";
  const link = listing.in_stock && listing.product_url
    ? `<a href="${listing.product_url}" target="_blank" rel="nofollow noopener">${priceText}</a>`
    : priceText;
  return `<tr class="${stockClass}"><td>${label}</td><td>${link}</td><td>${stockText}</td></tr>`;
}

function createKyuuraTile(group) {
  const tile = document.createElement("div");
  tile.className = "card-tile kyuura-tile";

  const img = document.createElement("img");
  img.src = group.image_url ? `card-images/${group.image_url}` : "";
  img.alt = group.name;
  img.loading = "lazy";

  const name = document.createElement("div");
  name.className = "name";
  const variantText = group.variant ? `(${group.variant})` : "";
  name.textContent = `${group.name} LV.${group.level}${variantText}`;

  const sub = document.createElement("div");
  sub.className = "sub";
  const markText = group.rarity_mark ? `【${group.rarity_mark}】` : "";
  const priceText = group.min_price !== null ? `${group.min_price.toLocaleString()}円〜` : "在庫なし";
  sub.innerHTML = `<span class="sub-meta">${escapeHtml(markText)}</span><span class="sub-price">${escapeHtml(priceText)}</span>`;

  const table = document.createElement("table");
  table.className = "price-site-table kyuura-condition-table";
  table.innerHTML = `<thead><tr><th>状態</th><th>価格</th><th>在庫</th></tr></thead>
    <tbody>${group.listings.map(conditionRowHtml).join("")}</tbody>`;

  const bestListing = group.listings.find((l) => l.in_stock) || null;
  const buyButtons = document.createElement("div");
  buyButtons.className = "purchase-buttons";
  buyButtons.innerHTML = bestListing ? kyuuraBuyButtonHtml(bestListing) : "";

  tile.append(img, name, sub, table, buyButtons);
  return tile;
}

function renderResults() {
  grid.innerHTML = "";
  for (const group of filteredGroups) {
    grid.appendChild(createKyuuraTile(group));
  }
}

init();
