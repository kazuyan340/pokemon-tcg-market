const FILTER_FIELDS = {
  category: { listId: "filter-category-list", groupId: "filter-category-group" },
  element: { listId: "filter-element-list", groupId: "filter-element-group" },
  rarity: { listId: "filter-rarity-list", groupId: "filter-rarity-group" },
  evolution_rank: { listId: "filter-evo-list", groupId: "filter-evo-group" },
  pack: { listId: "filter-pack-list", groupId: "filter-pack-group" },
};

let allCards = [];
let filteredCards = [];

const grid = document.getElementById("card-grid");
const resultCount = document.getElementById("result-count");
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
    } else if (field === "pack") {
      values.sort((a, b) => a.localeCompare(b, "ja"));
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

  document.getElementById("reset-filters").addEventListener("click", () => {
    keywordInput.value = "";
    sortSelect.value = "popularity_desc";
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

function applyFilters() {
  const keyword = keywordInput.value.trim().toLowerCase();
  const selected = {};
  for (const [field, { listId }] of Object.entries(FILTER_FIELDS)) {
    selected[field] = getFilterSelection(listId);
  }

  filteredCards = allCards.filter((c) => {
    if (keyword) {
      const haystack = `${c.name || ""} ${c.ability_description || ""} ${c.description || ""} ${c.category || ""}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    for (const field of Object.keys(FILTER_FIELDS)) {
      const cardValues = valuesForField(c, field);
      if (!matchesFilterSelection(cardValues, selected[field])) return false;
    }
    return true;
  });

  filteredCards = sortCards(filteredCards, sortSelect.value);

  resultCount.textContent = `${filteredCards.length} 件ヒット`;
  renderResults();
}

function renderResults() {
  grid.innerHTML = "";
  for (const card of filteredCards) {
    grid.appendChild(createCardTile(card));
  }
}

init();
