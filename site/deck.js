// デッキ作成ツール。左側にデッキ全体(パートナー・事件・メインデッキ40枚)を常に表示し、
// 右側の検索パネルでカードをクリックするとそのままデッキに追加される。
// デッキの空き枠をクリックすると、右側の絞り込みがその枠に合った種類に切り替わる。
const MAIN_DECK_SIZE = 60;
const MAX_COPIES = 4;
const DECK_LIST_KEY = "pokemonTcgDeckBuilderList";
const CARD_TYPES = ["ポケモン", "グッズ", "サポート", "スタジアム", "ポケモンのどうぐ", "基本エネルギー", "特殊エネルギー"];

const FILTER_FIELDS = {
  element: { listId: "filter-color-list", groupId: "filter-color-group" },
  rarity: { listId: "filter-rarity-list", groupId: "filter-rarity-group" },
  pack: { listId: "filter-pack-list", groupId: "filter-pack-group" },
};

let allCards = [];
let cardById = new Map();
let filteredCards = [];
let selectedTypes = new Set(CARD_TYPES);
// 種類ボタンのうち、今クリックできるもの。パートナー/事件枠にフォーカスしている間は
// 空(その1種類に固定・押しても外せない)。メインデッキ枠ではキャラ/イベントだけ
// 押せる(パートナー/事件はメインデッキに入れられないので常に灰色)。
let allowedTypes = new Set(CARD_TYPES);

// 複数デッキを保存できるようにする。deckListの各要素が1デッキ分。
// 参照画面(showDeckView)ではdeck変数はdeckList内の該当要素への参照そのものだが、
// 編集画面(showDeckEdit)に入る際はcloneDeck()でコピーしたものに差し替える。
// 「保存」ボタン(saveEditedDeck)を押すまではdeckList側には反映されない。
// deck = { id, name, partner: cardId|null, case: cardId|null, main: { cardId: count } }
let deckList = [];
let currentDeckId = null;
let deck = { id: null, name: "", partner: null, case: null, main: {} };
let openedSharedDeckFromUrl = false;
// 編集画面に入ったら、そのデッキのコピー(deck変数)に対してのみ変更を加え、
// 「保存」ボタンを押すまではdeckList(=localStorageに書き込まれる本体)には反映しない。
// これにより、編集途中で画面を離れてもデッキ一覧には影響しない。
let hasUnsavedChanges = false;
const INCLUDE_PARTNER_CASE_KEY = "pokemonTcgDeckIncludePartnerCase";
let includePartnerCaseInTotal = localStorage.getItem(INCLUDE_PARTNER_CASE_KEY) !== "false";

const grid = document.getElementById("card-grid");
const resultCount = document.getElementById("result-count");
const keywordInput = document.getElementById("keyword");
const sortSelect = document.getElementById("sort-select");
const deckSortSelect = document.getElementById("deck-sort-select");
let deckSortMode = "name_asc";

async function init() {
  allCards = await loadCardData();
  cardById = new Map(allCards.map((c) => [c.id, c]));
  renderTypeToggles();
  populateFilterOptions();
  bindEvents();
  bindModalEvents();
  bindNavMenuToggle();
  bindFilterDropdownPositioning();
  loadDeckFromUrlOrStorage();
  applyFilters();
  renderDeckList();
  renderDeckPanel();
  renderLastUpdated();
  // URL経由で共有デッキを開いた場合は、選択画面を経由せずそのまま参照画面を開く。
  if (openedSharedDeckFromUrl) {
    showDeckView();
  } else {
    showDeckSelect();
  }
}

// デッキ選択画面⇔参照画面⇔編集画面の切り替え。「デッキ一覧に戻る」ボタンは
// ページ上部のナビ内(他ページの一覧リンクと同じ場所)にあり、選択画面自体に
// いるときだけ非表示にする。
function showDeckSelect() {
  document.getElementById("view-deck-select").classList.remove("hidden");
  document.getElementById("view-deck-view").classList.add("hidden");
  document.getElementById("view-deck-edit").classList.add("hidden");
  document.getElementById("back-to-deck-list-nav").classList.add("hidden");
  renderDeckList();
}

// デッキ一覧から開いた直後の閲覧専用画面。ここから「編集する」で編集画面に進む。
function showDeckView() {
  document.getElementById("view-deck-select").classList.add("hidden");
  document.getElementById("view-deck-view").classList.remove("hidden");
  document.getElementById("view-deck-edit").classList.add("hidden");
  document.getElementById("back-to-deck-list-nav").classList.remove("hidden");
  document.getElementById("deck-view-title").textContent = deck.name || "";
  renderDeckViewPanel();
}

function showDeckEdit() {
  document.getElementById("view-deck-select").classList.add("hidden");
  document.getElementById("view-deck-view").classList.add("hidden");
  document.getElementById("view-deck-edit").classList.remove("hidden");
  document.getElementById("back-to-deck-list-nav").classList.remove("hidden");
  document.getElementById("deck-edit-title").textContent = deck.name || "";
  setUnsavedChanges(false);
  renderDeckPanel();
}

function cloneDeck(d) {
  return JSON.parse(JSON.stringify(d));
}

// 編集画面での変更はいったんこの関数経由でフラグを立てるだけにし、
// deckList(=保存済みデータ)には触れない。実際の保存は「保存」ボタン(saveEditedDeck)で行う。
function markDirty() {
  setUnsavedChanges(true);
  renderDeckPanel();
}

function setUnsavedChanges(value) {
  hasUnsavedChanges = value;
  const indicator = document.getElementById("unsaved-indicator");
  if (indicator) indicator.classList.toggle("hidden", !value);
}

// 編集中のデッキ(deck)の内容をdeckListの該当エントリに書き戻し、localStorageに保存する。
function saveEditedDeck() {
  const idx = deckList.findIndex((d) => d.id === deck.id);
  if (idx === -1) return;
  deckList[idx] = cloneDeck(deck);
  saveDeck();
  setUnsavedChanges(false);
  renderDeckList();

  const btn = document.getElementById("save-deck-btn");
  if (btn) {
    const original = "💾 保存";
    btn.textContent = "✅ 保存しました";
    setTimeout(() => {
      btn.textContent = original;
    }, 1500);
  }
}

// 未保存の変更があるまま編集画面を離れようとした場合に確認する。
// 「キャンセル」されたらfalseを返し、呼び出し側は画面遷移を中止する。
function confirmDiscardIfNeeded() {
  if (!hasUnsavedChanges) return true;
  const ok = confirm("保存されていない変更があります。破棄してデッキ一覧に戻りますか?");
  if (ok) {
    setUnsavedChanges(false);
    const found = deckList.find((d) => d.id === deck.id);
    if (found) deck = found;
  }
  return ok;
}

// .checkbox-listはposition:absoluteで浮かせているが、検索パネル自体が
// overflow-y:autoでスクロールする箱になっているため、そのままだと箱の外に出る分が
// 切れて表示され、下の方のチェックが押せなくなる。開いた瞬間にposition:fixedへ
// 切り替えて、実際の画面上の座標を計算し直すことでこれを回避する。
function bindFilterDropdownPositioning() {
  for (const details of document.querySelectorAll(".deck-search-panel .filter-group")) {
    details.addEventListener("toggle", () => {
      const list = details.querySelector(".checkbox-list");
      if (!list) return;
      if (details.open) {
        const rect = details.getBoundingClientRect();
        list.style.position = "fixed";
        list.style.top = `${rect.bottom + 4}px`;
        list.style.left = `${rect.left}px`;
      }
    });
  }
}

function valuesForField(card, field) {
  const raw = card[field];
  if (raw === null || raw === undefined || raw === "") return [];
  if (field === "color") {
    return [...String(raw)].filter((ch) => ch !== ",");
  }
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// カード種類のトグルボタン(複数選択可)。パートナー/事件枠をクリックしたときは
// focusPickerOn()で強制的に1種類だけに絞り込み、allowedTypesに無い種類のボタンは
// 押せなくする(その枠に別種類のカードを入れてしまう誤操作を防ぐため)。
function renderTypeToggles() {
  const container = document.getElementById("filter-type-list");
  container.innerHTML = "";
  for (const type of CARD_TYPES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "type-toggle";
    btn.dataset.type = type;
    btn.classList.toggle("active", selectedTypes.has(type));
    btn.disabled = !allowedTypes.has(type);
    btn.textContent = type;
    btn.addEventListener("click", () => {
      if (!allowedTypes.has(type)) return;
      if (selectedTypes.has(type)) selectedTypes.delete(type);
      else selectedTypes.add(type);
      syncTypeToggleButtons();
      applyFilters();
    });
    container.appendChild(btn);
  }
}

function syncTypeToggleButtons() {
  for (const btn of document.querySelectorAll(".type-toggle")) {
    btn.disabled = !allowedTypes.has(btn.dataset.type);
    btn.classList.toggle("active", selectedTypes.has(btn.dataset.type));
  }
}

// デッキの枠(パートナー/事件/メインデッキ)をクリックしたときに呼ぶ。右側の絞り込みを
// その種類だけにして、検索パネルにスクロールする。
// 色/レアリティ/レベル/収録パックのチェックを全部外し、キーワードもクリアする。
// パートナー⇔事件⇔メインデッキと切り替えたときに、前の絞り込み条件(例: レアリティSEC)が
// 残ったまま新しい種類には該当カードが無く「0件」になってしまう問題を防ぐため。
function resetCheckboxFilters() {
  keywordInput.value = "";
  for (const checkbox of document.querySelectorAll(".checkbox-list input")) {
    resetTriStateCheckbox(checkbox);
  }
  for (const field of Object.keys(FILTER_FIELDS)) {
    updateCountBadge(field);
  }
}

function focusPickerOn(type) {
  selectedTypes = new Set([type]);
  allowedTypes = new Set();
  syncTypeToggleButtons();
  resetCheckboxFilters();
  applyFilters();
  document.querySelector(".deck-search-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  keywordInput.focus();
}

// 色・レアリティフィルタは五十音順だと並びがバラバラで見づらいため、固定の表示順にする。
const COLOR_ORDER = ["青", "緑", "白", "赤", "黄", "黒"];
const RARITY_ORDER = [
  "C", "CP", "CP2", "R", "RP", "SR", "SRP", "SRCP", "MR", "MRP", "MRCP", "D", "PR", "SEC",
];

function populateFilterOptions() {
  for (const [field, { listId }] of Object.entries(FILTER_FIELDS)) {
    const listEl = document.getElementById(listId);
    const values = [...new Set(allCards.flatMap((c) => valuesForField(c, field)))];
    if (field === "level") {
      values.sort((a, b) => Number(a) - Number(b));
    } else if (field === "color") {
      values.sort((a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b));
    } else if (field === "rarity") {
      values.sort((a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b));
    } else if (field === "pack") {
      sortPackValues(values);
    } else {
      values.sort((a, b) => a.localeCompare(b, "ja"));
    }

    let lastPackGroup = null;
    for (const v of values) {
      if (field === "pack") {
        const g = packGroupFor(v);
        if (g !== lastPackGroup) {
          const heading = document.createElement("div");
          heading.className = "checkbox-list-heading";
          heading.textContent = PACK_GROUP_LABELS[g];
          listEl.appendChild(heading);
          lastPackGroup = g;
        }
      }
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
  deckSortSelect.addEventListener("change", () => {
    deckSortMode = deckSortSelect.value;
    renderDeckPanel();
  });

  const includeCheckbox = document.getElementById("include-partner-case");
  includeCheckbox.checked = includePartnerCaseInTotal;
  includeCheckbox.addEventListener("change", () => {
    includePartnerCaseInTotal = includeCheckbox.checked;
    localStorage.setItem(INCLUDE_PARTNER_CASE_KEY, String(includePartnerCaseInTotal));
    renderDeckPanel();
    renderDeckList();
  });

  document.getElementById("clear-deck").addEventListener("click", () => {
    if (!confirm("このデッキの内容をすべてクリアします。よろしいですか?")) return;
    deck.partner = null;
    deck.case = null;
    deck.main = {};
    markDirty();
  });

  document.getElementById("share-deck").addEventListener("click", shareDeckUrl);
  document.getElementById("max-rarity-deck").addEventListener("click", () => swapDeckToExtremeRarity(true));
  document.getElementById("min-rarity-deck").addEventListener("click", () => swapDeckToExtremeRarity(false));
  document.getElementById("back-to-deck-list-nav").addEventListener("click", () => {
    if (!confirmDiscardIfNeeded()) return;
    showDeckSelect();
  });
  document.getElementById("edit-deck-btn").addEventListener("click", () => {
    deck = cloneDeck(deck);
    showDeckEdit();
  });
  document.getElementById("rename-deck-btn").addEventListener("click", renameDeck);
  document.getElementById("save-deck-btn").addEventListener("click", saveEditedDeck);

  window.addEventListener("beforeunload", (e) => {
    if (!hasUnsavedChanges) return;
    e.preventDefault();
    e.returnValue = "";
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

// deckListとcurrentDeckIdをまとめてlocalStorageに保存する。deckはdeckList内の
// 要素への参照なので、deck.main[...]などの変更はdeckList側にもすでに反映済み。
function saveDeck() {
  try {
    localStorage.setItem(DECK_LIST_KEY, JSON.stringify({ decks: deckList, currentDeckId }));
  } catch {
    // localStorageが使えない環境では保存をあきらめる(致命的ではない)
  }
}

function makeEmptyDeck(name) {
  return { id: `deck-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, partner: null, case: null, main: {} };
}

// 新しいデッキを作って切り替える。
function createNewDeck() {
  const name = prompt("デッキ名を入力してください", `デッキ${deckList.length + 1}`);
  if (name === null) return;
  const fresh = makeEmptyDeck(name || `デッキ${deckList.length + 1}`);
  deckList.push(fresh);
  currentDeckId = fresh.id;
  saveDeck();
  // 編集画面ではdeckListの実体ではなくコピーを操作する(保存ボタンを押すまで反映しない)。
  deck = cloneDeck(fresh);
  showDeckEdit();
}

// 編集画面のタイトル横「✏️ 名前を変更」ボタン用。現在編集中のデッキ名を変更する。
function renameDeck() {
  const name = prompt("デッキ名を入力してください", deck.name || "");
  if (name === null || name.trim() === "") return;
  deck.name = name.trim();
  setUnsavedChanges(true);
  document.getElementById("deck-edit-title").textContent = deck.name;
}

function switchToDeck(id) {
  const found = deckList.find((d) => d.id === id);
  if (!found) return;
  currentDeckId = id;
  deck = found;
  saveDeck();
  showDeckView();
}

function deleteDeck(id) {
  if (!confirm("このデッキを削除します。よろしいですか?")) return;
  deckList = deckList.filter((d) => d.id !== id);
  if (currentDeckId === id) {
    if (deckList.length > 0) {
      currentDeckId = deckList[0].id;
      deck = deckList[0];
    } else {
      // デッキが0個になった場合は選択中のデッキも無しにする(0個で問題ない)。
      currentDeckId = null;
      deck = { id: null, name: "", partner: null, case: null, main: {} };
    }
  }
  saveDeck();
  renderDeckList();
}

function loadDeckFromUrlOrStorage() {
  // DECK_LIST_KEY自体が存在するかどうかで、「一度も使ったことが無い(初回)」と
  // 「使った結果、自分で全デッキを削除して0件にした」を区別する。後者の場合は
  // 0件のまま尊重し、勝手に「デッキ1」を作り直さない。
  let hasExistingListKey = false;
  try {
    const raw = localStorage.getItem(DECK_LIST_KEY);
    if (raw !== null) {
      hasExistingListKey = true;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.decks)) {
        deckList = parsed.decks;
        if (deckList.length > 0) {
          currentDeckId = deckList.some((d) => d.id === parsed.currentDeckId) ? parsed.currentDeckId : deckList[0].id;
          deck = deckList.find((d) => d.id === currentDeckId);
        } else {
          currentDeckId = null;
          deck = { id: null, name: "", partner: null, case: null, main: {} };
        }
      }
    }
  } catch {
    // 壊れたデータは無視して初期状態のまま
  }

  // 複数デッキ対応前の古いデータ(単一デッキ)が残っていれば、「デッキ1」として引き継ぐ。
  if (!hasExistingListKey && deckList.length === 0) {
    let migrated = null;
    try {
      const old = localStorage.getItem("pokemonTcgDeckBuilder");
      if (old) {
        const parsedOld = JSON.parse(old);
        if (parsedOld && (parsedOld.partner || parsedOld.case || Object.keys(parsedOld.main || {}).length > 0)) {
          migrated = makeEmptyDeck("デッキ1");
          migrated.partner = parsedOld.partner ?? null;
          migrated.case = parsedOld.case ?? null;
          migrated.main = parsedOld.main || {};
        }
      }
    } catch {
      // 古いデータが壊れている場合は無視する
    }
    const fresh = migrated || makeEmptyDeck("デッキ1");
    deckList = [fresh];
    currentDeckId = fresh.id;
    deck = fresh;
  }

  // URLに共有デッキが埋め込まれている場合は、確認してから既存のデッキを上書きせず
  // 新しいデッキとして追加する。保存しない場合は何もせず通常通りの一覧を表示する。
  const fromUrl = new URLSearchParams(location.search).get("deck");
  if (fromUrl) {
    try {
      const decoded = JSON.parse(decodeURIComponent(escape(atob(fromUrl))));
      if (decoded && typeof decoded === "object") {
        if (confirm("共有されたデッキを保存しますか?(自分のデッキ一覧に新しく追加されます)")) {
          const shared = makeEmptyDeck("共有されたデッキ");
          shared.partner = decoded.partner ?? null;
          shared.case = decoded.case ?? null;
          shared.main = decoded.main || {};
          deckList.push(shared);
          currentDeckId = shared.id;
          deck = shared;
          saveDeck();
          openedSharedDeckFromUrl = true;
        }
        // URLにデッキデータを残したままだと、再読み込みのたびにまた確認が出てしまうため、
        // 保存の有無に関わらずURLからは消しておく。
        history.replaceState(null, "", location.pathname);
      }
    } catch {
      // URLのデッキデータが壊れている場合は無視する
    }
  }

  saveDeck();
}

// デッキ一覧バー(保存済みデッキをカードで並べ、クリックで切り替え・削除できる)を描画する。
// 指定したデッキ(deckList中の1件)の合計金額を計算する。現在編集中でないデッキも含めて
// 一覧に金額を出すための共通ヘルパー(ページを開くたびに最新のdata/prices_latest.jsonから
// 計算するので、毎晩の自動更新結果がそのまま反映される)。
function computeDeckTotal(d) {
  let total = 0;
  if (includePartnerCaseInTotal) {
    const partnerCard = d.partner ? cardById.get(d.partner) : null;
    const caseCard = d.case ? cardById.get(d.case) : null;
    for (const c of [partnerCard, caseCard]) {
      if (!c) continue;
      const p = cardPrice(c);
      if (p !== null) total += p;
    }
  }
  for (const [idStr, count] of Object.entries(d.main || {})) {
    const card = cardById.get(Number(idStr));
    if (!card) continue;
    const p = cardPrice(card);
    if (p !== null) total += p * count;
  }
  return total;
}

function renderDeckList() {
  const bar = document.getElementById("deck-list-bar");
  bar.innerHTML = "";

  for (const d of deckList) {
    const tile = document.createElement("div");
    tile.className = "deck-list-tile" + (d.id === currentDeckId ? " active" : "");

    const partnerCard = d.partner ? cardById.get(d.partner) : null;
    const caseCard = d.case ? cardById.get(d.case) : null;
    const mainCount = Object.values(d.main || {}).reduce((sum, n) => sum + n, 0);
    const total = computeDeckTotal(d);

    tile.innerHTML = `
      <div class="deck-list-thumbs">
        <div class="deck-list-thumb${partnerCard ? "" : " empty"}">${partnerCard ? `<img src="${partnerCard.image_url || ""}" alt="">` : ""}</div>
        <div class="deck-list-thumb deck-list-thumb-case${caseCard ? "" : " empty"}">${caseCard ? `<img src="${caseCard.image_url || ""}" alt="">` : ""}</div>
      </div>
      <div class="deck-list-info">
        <div class="deck-list-name">${escapeHtml(d.name || "無題のデッキ")}</div>
        <div class="deck-list-count">${mainCount}/${MAIN_DECK_SIZE}枚</div>
        <div class="deck-list-price">${total.toLocaleString()}円</div>
      </div>
      <button type="button" class="deck-list-delete" title="このデッキを削除">&times;</button>
    `;
    tile.addEventListener("click", () => switchToDeck(d.id));
    tile.querySelector(".deck-list-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteDeck(d.id);
    });
    bar.appendChild(tile);
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "deck-list-add";
  addBtn.textContent = "+ 新しいデッキ";
  addBtn.addEventListener("click", createNewDeck);
  bar.appendChild(addBtn);
}

function shareDeckUrl() {
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(deck))));
  const url = `${location.origin}${location.pathname}?deck=${encoded}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(
      () => alert("デッキのURLをコピーしました。"),
      () => prompt("このURLをコピーしてください:", url)
    );
  } else {
    prompt("このURLをコピーしてください:", url);
  }
}

function cardPrice(card) {
  return pooledAveragePriceFromLatest(card.id);
}

function mainDeckCount() {
  return Object.values(deck.main).reduce((sum, n) => sum + n, 0);
}

// カードをクリックしたときの挙動。パートナー/事件は1枚選択の置き換え、
// キャラ/イベントはメインデッキへの加算(3枚上限・40枚上限を守る)。
function addCard(card) {
  if (card.category === "パートナー") {
    deck.partner = card.id;
    markDirty();
    return;
  }
  if (card.category === "事件") {
    deck.case = card.id;
    markDirty();
    return;
  }
  if (!isUnlimitedCopyCard(card) && copiesInGroup(card) >= MAX_COPIES) {
    alert(`同じカード(レアリティ違いを含む)は最大${MAX_COPIES}枚までです。`);
    return;
  }
  if (mainDeckCount() >= MAIN_DECK_SIZE) {
    alert(`メインデッキは${MAIN_DECK_SIZE}枚までです。`);
    return;
  }
  deck.main[card.id] = (deck.main[card.id] || 0) + 1;
  markDirty();
}

// 「同じカード」判定キー。card_text_idは印刷違い(レアリティ・収録パック違いの
// 再録)でも共通の値になっているため、これで同一カードとして4枚制限をまとめて数えられる。
function copyGroupKey(card) {
  return card.card_text_id;
}

// 実際のポケモンカードルールでは「基本エネルギー」(category === "基本エネルギー")は
// 4枚制限の対象外(同名カードを何枚でもデッキに入れられる)。特殊エネルギーや
// それ以外のカード種別は通常どおり4枚制限の対象。
function isUnlimitedCopyCard(card) {
  return card && card.category === "基本エネルギー";
}

// 現在デッキに入っている、同じカード(レアリティ違い含む)の合計枚数。
function copiesInGroup(card) {
  const key = copyGroupKey(card);
  let total = 0;
  for (const [idStr, count] of Object.entries(deck.main)) {
    const other = cardById.get(Number(idStr));
    if (other && copyGroupKey(other) === key) total += count;
  }
  return total;
}

// デッキ内の各カードを、同じカード(copyGroupKey基準、レアリティ違い/再録含む)の中で
// 相場が一番高い/安いバリアントに一括で入れ替える。価格データが無いカードや、
// バリアントが1種類しか無いカードはそのまま(変えようが無い)。
function bestVariantId(cardId, wantMax) {
  const currentCard = cardById.get(cardId);
  if (!currentCard) return cardId;
  const key = copyGroupKey(currentCard);
  const priced = allCards
    .filter((c) => copyGroupKey(c) === key)
    .map((c) => ({ id: c.id, price: cardPrice(c) }))
    .filter((v) => v.price !== null);
  if (priced.length === 0) return cardId;
  const best = priced.reduce((acc, cur) => {
    if (wantMax) return cur.price > acc.price ? cur : acc;
    return cur.price < acc.price ? cur : acc;
  });
  return best.id;
}

function swapDeckToExtremeRarity(wantMax) {
  const newMain = {};
  for (const [idStr, count] of Object.entries(deck.main)) {
    const newId = bestVariantId(Number(idStr), wantMax);
    newMain[newId] = (newMain[newId] || 0) + count;
  }
  deck.main = newMain;

  if (deck.partner) deck.partner = bestVariantId(deck.partner, wantMax);
  if (deck.case) deck.case = bestVariantId(deck.case, wantMax);

  markDirty();
}

function removeOneFromMainDeck(cardId) {
  const current = deck.main[cardId] || 0;
  if (current <= 1) {
    delete deck.main[cardId];
  } else {
    deck.main[cardId] = current - 1;
  }
  markDirty();
}

// 検索結果のカード1枚分のタイルを作る。タイルをクリックするとそのままデッキに追加される。
// 画像上の🔍アイコンをクリックすると、相場詳細のモーダルを開く(誤クリック防止のためstopPropagation)。
function createSearchTile(card) {
  const tile = document.createElement("div");
  tile.className = "card-tile";
  tile.title = card.name;
  const price = cardPrice(card);
  const priceText = price !== null ? `${price.toLocaleString()}円` : "-";

  tile.innerHTML = `
    <div class="trend-badge">${escapeHtml(priceText)}</div>
    <div class="deck-tile-img-wrap">
      <img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}" loading="lazy">
      <button type="button" class="deck-info-btn" title="詳細を見る">🔍</button>
    </div>
  `;

  tile.addEventListener("click", () => addCard(card));
  tile.querySelector(".deck-info-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openModal(card);
  });

  return tile;
}

function applyFilters() {
  const keyword = keywordInput.value.trim().toLowerCase();
  const selected = {};
  for (const [field, { listId }] of Object.entries(FILTER_FIELDS)) {
    selected[field] = getFilterSelection(listId);
  }

  filteredCards = allCards.filter((c) => {
    // selectedTypesが空(キャラ/イベントを両方オフにした等)の場合は「絞り込み無し」
    // ではなく「該当なし」にする(空のときだけ他の種類まで出てきてしまう不具合だった)。
    if (!selectedTypes.has(c.category)) return false;
    if (keyword && !String(c.name || "").toLowerCase().includes(keyword)) return false;
    for (const field of Object.keys(FILTER_FIELDS)) {
      const cardValues = valuesForField(c, field);
      if (!matchesFilterSelection(cardValues, selected[field])) return false;
    }
    return true;
  });

  filteredCards = sortCards(filteredCards, sortSelect.value);

  resultCount.textContent = `${filteredCards.length} 件`;
  renderResults();
}

function renderResults() {
  grid.innerHTML = "";
  filteredCards.forEach((card) => grid.appendChild(createSearchTile(card)));
}

// パートナー/事件の枠(カード形の箱)を描画する。空なら「クリックして絞り込む」空枠、
// 選択済みならカード画像+解除ボタン。
function renderSlotBox(elId, cardId, focusType, onClear) {
  const el = document.getElementById(elId);
  el.classList.toggle("empty", !cardId);
  // 空き枠はもちろん、選択済みでもクリックすれば選び直せるように、常に絞り込みを開く。
  // (×ボタンだけは解除の役割なのでstopPropagationで区別する)
  el.onclick = () => focusPickerOn(focusType);

  if (!cardId || !cardById.has(cardId)) {
    el.innerHTML = "";
    return;
  }
  const card = cardById.get(cardId);
  el.innerHTML = `
    <img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}">
    <button type="button" class="deck-slot-clear" title="解除">&times;</button>
  `;
  el.querySelector(".deck-slot-clear").addEventListener("click", (e) => {
    e.stopPropagation();
    onClear();
  });
}

// メインデッキ枠の並び替え。検索パネルのsortByOrderと同じ"フィールド名_asc|desc"形式。
// 数値項目(レベル/AP/LP)は値が無いカードを昇順/降順を問わず常に末尾に回す
// (同値・欠損時は名前順で安定させる)。番号順は駿河屋等と同じcard_num表記
// (英字+数字混在)なので、数字部分も考慮するnumeric照合を使う。
function deckEntryCompare(a, b, sortMode) {
  // "card_num_asc"のようにフィールド名自体に"_"を含むため、末尾の"_asc"/"_desc"
  // だけを区切る(先頭からのsplit("_")だと"card_num"が"card"+"num"に割れてしまう)。
  const cut = sortMode.lastIndexOf("_");
  const field = sortMode.slice(0, cut);
  const direction = sortMode.slice(cut + 1);
  const sign = direction === "desc" ? -1 : 1;

  if (field === "card_num") {
    return sign * (a.card.card_num || "").localeCompare(b.card.card_num || "", "ja", { numeric: true });
  }
  if (field === "level" || field === "ap" || field === "lp") {
    const av = a.card[field];
    const bv = b.card[field];
    const aMissing = av === null || av === undefined;
    const bMissing = bv === null || bv === undefined;
    if (aMissing && bMissing) return a.card.name.localeCompare(b.card.name, "ja");
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (av !== bv) return sign * (av - bv);
  }
  return sign * a.card.name.localeCompare(b.card.name, "ja");
}

function renderDeckPanel() {
  renderSlotBox("deck-partner", deck.partner, "パートナー", () => {
    deck.partner = null;
    markDirty();
  });
  renderSlotBox("deck-case", deck.case, "事件", () => {
    deck.case = null;
    markDirty();
  });

  // メインデッキ40枚を、カードごとの枚数を個々の枠に展開して描画する
  // (非公式デッキメーカーを参考に、1枠=1枚の見た目にしている)。
  const mainGrid = document.getElementById("deck-main-grid");
  mainGrid.innerHTML = "";

  const entries = Object.entries(deck.main)
    .map(([id, count]) => ({ card: cardById.get(Number(id)), count }))
    .filter((e) => e.card)
    .sort((a, b) => deckEntryCompare(a, b, deckSortMode));

  const total = computeDeckTotal(deck);

  let slotsFilled = 0;
  for (const { card, count } of entries) {
    for (let i = 0; i < count; i++) {
      const slot = document.createElement("div");
      slot.className = "deck-slot-box";
      slot.title = `${card.name}(クリックで1枚減らす)`;
      slot.innerHTML = `<img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}">`;
      slot.addEventListener("click", () => removeOneFromMainDeck(card.id));
      mainGrid.appendChild(slot);
      slotsFilled++;
    }
  }
  for (let i = slotsFilled; i < MAIN_DECK_SIZE; i++) {
    const slot = document.createElement("div");
    slot.className = "deck-slot-box empty";
    slot.addEventListener("click", () => focusPickerOnMain());
    mainGrid.appendChild(slot);
  }

  const count = mainDeckCount();
  const countEl = document.getElementById("deck-count");
  countEl.textContent = `メインデッキ ${count}/${MAIN_DECK_SIZE}枚`;
  countEl.classList.toggle("deck-count-ok", count === MAIN_DECK_SIZE);

  document.getElementById("deck-total").textContent = `合計 ${total.toLocaleString()}円`;
}

// 参照画面のパートナー/事件の枠。編集画面のrenderSlotBoxと違い、クリックしても
// 絞り込みは開かず、カードが入っていればモーダルを開くだけ(閲覧専用)。
function renderViewSlotBox(elId, cardId) {
  const el = document.getElementById(elId);
  el.classList.toggle("empty", !cardId || !cardById.has(cardId));

  if (!cardId || !cardById.has(cardId)) {
    el.innerHTML = "";
    el.onclick = null;
    return;
  }
  const card = cardById.get(cardId);
  el.innerHTML = `<img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}">`;
  el.onclick = () => openModal(card);
}

// 参照画面の描画。編集画面のrenderDeckPanelと違い、カードクリックは全部モーダルを
// 開くだけで、追加/削除や絞り込みは行わない。
function renderDeckViewPanel() {
  renderViewSlotBox("deck-view-partner", deck.partner);
  renderViewSlotBox("deck-view-case", deck.case);

  const mainGrid = document.getElementById("deck-view-main-grid");
  mainGrid.innerHTML = "";

  const entries = Object.entries(deck.main)
    .map(([id, count]) => ({ card: cardById.get(Number(id)), count }))
    .filter((e) => e.card)
    .sort((a, b) => a.card.name.localeCompare(b.card.name, "ja"));

  for (const { card, count } of entries) {
    for (let i = 0; i < count; i++) {
      const slot = document.createElement("div");
      slot.className = "deck-slot-box";
      slot.title = card.name;
      slot.innerHTML = `<img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}">`;
      slot.addEventListener("click", () => openModal(card));
      mainGrid.appendChild(slot);
    }
  }

  const count = mainDeckCount();
  document.getElementById("deck-view-count").textContent = `メインデッキ ${count}/${MAIN_DECK_SIZE}枚`;
  const total = computeDeckTotal(deck);
  document.getElementById("deck-view-total").textContent = `合計 ${total.toLocaleString()}円`;
}

// メインデッキの空き枠クリック用: キャラ+イベント両方に絞り込む(1種類固定のfocusPickerOnとは別扱い)。
function focusPickerOnMain() {
  selectedTypes = new Set(CARD_TYPES);
  allowedTypes = new Set(CARD_TYPES);
  syncTypeToggleButtons();
  resetCheckboxFilters();
  applyFilters();
  document.querySelector(".deck-search-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  keywordInput.focus();
}

init();
