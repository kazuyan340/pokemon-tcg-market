// 相場ランキング(収録パック/レアリティ等で絞り込みつつ、相場(全サイト加重平均)が高い順に並べるページ)。
// フィルタ周りはapp.js(一覧画面)と同じ仕組みを踏襲している。
const PAGE_SIZE = 50;
const FILTER_FIELDS = {
  category: { listId: "filter-category-list", groupId: "filter-category-group" },
  element: { listId: "filter-element-list", groupId: "filter-element-group" },
  rarity: { listId: "filter-rarity-list", groupId: "filter-rarity-group" },
  evolution_rank: { listId: "filter-evo-list", groupId: "filter-evo-group" },
  pack: { listId: "filter-pack-list", groupId: "filter-pack-group" },
};

let allCards = [];
let filteredEntries = [];
let currentPage = 0;

const grid = document.getElementById("card-grid");
const resultCount = document.getElementById("result-count");
const pageLabel = document.getElementById("page-label");
const keywordInput = document.getElementById("keyword");
const sortSelect = document.getElementById("sort-select");

async function init() {
  allCards = await loadCardData();
  populateFilterOptions();
  bindEvents();
  bindModalEvents();
  bindFiltersToggle();
  bindNavMenuToggle();
  applyFilters();
  renderLastUpdated();
}

function valuesForField(card, field) {
  const raw = card[field];
  if (raw === null || raw === undefined || raw === "") return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// カテゴリ・タイプ・レアリティフィルタは決まった順序で見せた方が探しやすいので固定表示順にする。
const CATEGORY_ORDER = ["ポケモン", "グッズ", "サポート", "スタジアム", "ポケモンのどうぐ", "基本エネルギー", "特殊エネルギー"];
const ELEMENT_ORDER = ["草", "炎", "水", "雷", "超", "闘", "悪", "鋼", "龍", "妖", "無"];
const EVO_ORDER = ["たね", "1 進化", "2 進化", "BREAK進化", "M進化", "V進化", "VMAX", "V-UNION", "レベルアップ", "伝説", "復元"];
const RARITY_ORDER = [
  "C", "U", "R", "RR", "RRR", "AR", "SR", "SAR", "S", "HR", "UR", "SSR", "A",
  "CHR", "CSR", "ACE", "MA", "MUR", "TR", "P", "PR", "-",
];

function populateFilterOptions() {
  for (const [field, { listId }] of Object.entries(FILTER_FIELDS)) {
    const listEl = document.getElementById(listId);
    const values = [...new Set(allCards.flatMap((c) => valuesForField(c, field)))];
    if (field === "category") {
      values.sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
    } else if (field === "element") {
      values.sort((a, b) => ELEMENT_ORDER.indexOf(a) - ELEMENT_ORDER.indexOf(b));
    } else if (field === "evolution_rank") {
      values.sort((a, b) => EVO_ORDER.indexOf(a) - EVO_ORDER.indexOf(b));
    } else if (field === "rarity") {
      values.sort((a, b) => {
        const ia = RARITY_ORDER.indexOf(a);
        const ib = RARITY_ORDER.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b, "ja");
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
    } else {
      values.sort((a, b) => a.localeCompare(b, "ja"));
    }

    for (const v of values) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = v;
      checkbox.dataset.field = field;
      bindTriStateFilterCheckbox(checkbox, () => {
        updateCountBadge(field);
        applyFilters();
      });
      label.appendChild(checkbox);
      label.append(` ${v}`);
      listEl.appendChild(label);
    }
  }
}

function updateCountBadge(field) {
  const { listId, groupId } = FILTER_FIELDS[field];
  const badge = document.querySelector(`#${groupId} .count-badge`);
  const n = filterSelectionCount(listId);
  badge.textContent = n || "";
  badge.classList.toggle("hidden", n === 0);
}

function bindEvents() {
  keywordInput.addEventListener("input", debounce(applyFilters, 200));
  sortSelect.addEventListener("change", applyFilters);

  document.getElementById("prev-page").addEventListener("click", () => {
    if (currentPage > 0) {
      currentPage--;
      renderPage();
    }
  });
  document.getElementById("next-page").addEventListener("click", () => {
    if (currentPage < totalPages() - 1) {
      currentPage++;
      renderPage();
    }
  });

  document.getElementById("reset-filters").addEventListener("click", () => {
    keywordInput.value = "";
    sortSelect.value = "price_desc";
    for (const checkbox of document.querySelectorAll(".checkbox-list input")) {
      resetTriStateCheckbox(checkbox);
    }
    for (const field of Object.keys(FILTER_FIELDS)) {
      updateCountBadge(field);
    }
    applyFilters();
  });

  document.addEventListener("click", (e) => {
    for (const details of document.querySelectorAll(".filter-group[open]")) {
      if (!details.contains(e.target)) {
        details.removeAttribute("open");
      }
    }
  });

}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ランキング用のカード代表価格(各サイト最安値の単純平均)。データが無ければnull。
function cardPrice(card) {
  return pooledAveragePriceFromLatest(card.id);
}

function applyFilters() {
  const keyword = keywordInput.value.trim().toLowerCase();
  const selected = {};
  for (const [field, { listId }] of Object.entries(FILTER_FIELDS)) {
    selected[field] = getFilterSelection(listId);
  }

  filteredEntries = allCards
    .filter((c) => {
      if (keyword) {
        const haystack = `${c.name || ""} ${c.ability_description || ""} ${c.description || ""} ${c.category || ""}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      for (const field of Object.keys(FILTER_FIELDS)) {
        const cardValues = valuesForField(c, field);
        if (!matchesFilterSelection(cardValues, selected[field])) return false;
      }
      return true;
    })
    .map((card) => ({ card, price: cardPrice(card) }))
    .filter((entry) => entry.price !== null)
    .sort((a, b) => b.price - a.price);

  // 表示順を選び直しても「#1」等の順位バッジは価格順のまま変わらないよう、
  // 表示順を決める前に価格順で確定させたrankを振っておく。
  filteredEntries.forEach((entry, i) => {
    entry.rank = i + 1;
  });

  filteredEntries = sortByOrder(filteredEntries, sortSelect.value, (entry, field) => {
    if (field === "price") return entry.price;
    return field === "id" ? entry.card.id : entry.card[field];
  });

  currentPage = 0;
  resultCount.textContent = `${filteredEntries.length} 件(価格データがあるカードのみ)`;
  renderPage();
}

function totalPages() {
  return Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
}

function createRankingTile(card, rank, price) {
  const tile = document.createElement("a");
  tile.className = "card-tile has-badge";
  tile.href = `card/${card.id}.html`;
  tile.innerHTML = `
    <div class="trend-badge">#${rank}　${price.toLocaleString()}円</div>
    <img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}" loading="lazy">
    <div class="name">${escapeHtml(card.name)}</div>
    <div class="sub">${escapeHtml(card.rarity || "")} / ${escapeHtml(card.element || "")}</div>
  `;

  const star = document.createElement("button");
  star.type = "button";
  star.className = "favorite-star" + (isFavorite(card.id) ? " active" : "");
  star.textContent = isFavorite(card.id) ? "★" : "☆";
  star.title = "お気に入り(価格チェック対象)に登録/解除";
  star.addEventListener("click", (e) => {
    // タイルが<a>タグのため、preventDefaultしないとブラウザ標準のリンク遷移が
    // 止まらず、星を押しただけでcard/{id}.htmlへ飛んでしまう(common.js参照)。
    e.preventDefault();
    e.stopPropagation();
    const nowFav = toggleFavorite(card.id);
    star.textContent = nowFav ? "★" : "☆";
    star.classList.toggle("active", nowFav);
  });
  tile.prepend(star);

  tile.addEventListener("click", (e) => {
    if (shouldOpenModalInstead(e)) openModal(card);
  });
  return tile;
}

function renderPage() {
  grid.innerHTML = "";
  const start = currentPage * PAGE_SIZE;
  const pageEntries = filteredEntries.slice(start, start + PAGE_SIZE);

  pageEntries.forEach(({ card, price, rank }) => {
    grid.appendChild(createRankingTile(card, rank, price));
  });

  pageLabel.textContent = `ページ ${currentPage + 1} / ${totalPages()}`;
  document.getElementById("prev-page").disabled = currentPage === 0;
  document.getElementById("next-page").disabled = currentPage >= totalPages() - 1;
  window.scrollTo({ top: 0 });
}

init();
