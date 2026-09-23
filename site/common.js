// index.html / compare.html(お気に入り=価格チェック画面) で共有するロジック(データ取得・カードタイル描画・モーダル・お気に入り管理)
// お気に入り=価格チェック対象。星をつけたカードがそのまま「お気に入り一覧」にも「価格チェック」にも並ぶ。
const FAVORITES_KEY = "pokemonTcgFavorites";

// trends.html/movers-up.html/movers-down.htmlで共有する、値動き系ページの
// サイトタブ・カードグリッド描画ロジック。「全体」は各サイト最安値を単純平均した
// 「相場」の日次推移が基準。
const TREND_SITES = ["全体", "駿河屋", "カードラボ", "竜のしっぽ", "わいTV", "カードラッシュ"];

function bySite(items, site) {
  return (items || []).filter((item) => item.site === site);
}

function trendBadgeLines(item) {
  const sign = item.change_pct > 0 ? "+" : "";
  return [`${sign}${item.change_pct}%`, `${item.previous_price}円 → ${item.latest_price}円`];
}

function appendTrendCardTile(grid, item, card, badgeLinesFn, badgeClass) {
  const badgeHtml = badgeLinesFn(item).map((line) => escapeHtml(line)).join("<br>");
  const tile = document.createElement("a");
  tile.className = "card-tile";
  tile.href = `card/${card.id}.html`;
  tile.innerHTML = `
    <div class="trend-badge ${badgeClass}">${badgeHtml}</div>
    <img src="${card.image_url || ""}" alt="${escapeHtml(card.name)}" loading="lazy">
    <div class="name">${escapeHtml(card.name)}</div>
    <div class="sub">${escapeHtml(card.rarity || "")} / ${escapeHtml(card.element || "")}</div>
  `;
  tile.addEventListener("click", (e) => {
    if (shouldOpenModalInstead(e)) openModal(card);
  });
  grid.appendChild(tile);
}

function renderTrendCardGrid(gridId, emptyId, items, cardById, badgeLinesFn, badgeClass = "") {
  const grid = document.getElementById(gridId);
  const emptyMessage = document.getElementById(emptyId);
  grid.innerHTML = "";

  if (!items || items.length === 0) {
    emptyMessage.classList.remove("hidden");
    return;
  }
  emptyMessage.classList.add("hidden");

  for (const item of items) {
    const card = cardById.get(item.card_id);
    if (!card) continue;
    appendTrendCardTile(grid, item, card, badgeLinesFn, badgeClass);
  }
}

// サイトタブ(#site-tabs)を描画し、切り替わるたびonChange(selectedSite)を呼ぶ。
// 選択状態はページごとに独立して持つ(呼び出し側はcontrollerを保持するだけでよい)。
function createSiteTabController(containerId, onChange) {
  let selectedSite = TREND_SITES[0];

  function render() {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    for (const site of TREND_SITES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "site-tab" + (site === selectedSite ? " active" : "");
      btn.textContent = site;
      btn.addEventListener("click", () => {
        selectedSite = site;
        render();
        onChange(selectedSite);
      });
      container.appendChild(btn);
    }
  }

  render();
  return { getSite: () => selectedSite };
}

// スマホ幅でヘッダーのナビリンク(値上がりを見る~グッズ等)を三本線ボタン1つに
// まとめ、押すと右から重なるドロワー(引き出しメニュー)で開く。裏に半透明の
// 暗幕(.nav-backdrop)を敷いて、開いている間は他の部分が少し暗く見えるようにする。
// 閉じるボタン・暗幕・8ページ分のHTMLへの追記を避けるため、要素はJS側で組み立てる。
// デスクトップでは.nav-menu-toggleがdisplay:noneでそもそも押せないため、ここは
// 常にバインドしておいて問題ない(全8ページで共有)。
function bindNavMenuToggle() {
  const btn = document.querySelector(".nav-menu-toggle");
  const nav = document.querySelector(".nav-links");
  if (!btn || !nav) return;

  // .toolbarはposition:sticky+z-indexでスタッキングコンテキストを作ってしまうため、
  // 暗幕をbody直下に置くとnav-links(.toolbarの中、position:fixed)より上に
  // 埋もれてしまい、z-indexをいくら上げても中の閉じるボタンが押せなくなる
  // (実際に発生したバグ)。暗幕もnav-linksと同じ.toolbar内に置き、同じ
  // スタッキングコンテキストの中でz-indexを比較させることで解決する。
  const backdrop = document.createElement("div");
  backdrop.className = "nav-backdrop";
  nav.parentNode.insertBefore(backdrop, nav);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "nav-drawer-close";
  closeBtn.setAttribute("aria-label", "閉じる");
  closeBtn.textContent = "✕";
  nav.insertBefore(closeBtn, nav.firstChild);

  function setOpen(isOpen) {
    nav.classList.toggle("open", isOpen);
    backdrop.classList.toggle("open", isOpen);
    btn.setAttribute("aria-expanded", String(isOpen));
    // ドロワーが開いている間は背後のページが一緒にスクロールしないようにする。
    document.body.style.overflow = isOpen ? "hidden" : "";
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!nav.classList.contains("open"));
  });

  closeBtn.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));

  document.addEventListener("click", (e) => {
    if (nav.classList.contains("open") && !nav.contains(e.target) && e.target !== btn) {
      setOpen(false);
    }
  });
}

// 絞り込みバー(#filters-panel)の開閉。index.html/ranking.htmlで共有する。
// ヘッダーがposition:stickyで常に画面上部に残るため、絞り込みを使わない間は
// たたんで表示領域を空けられるようにする。開閉状態はlocalStorageに保存し、
// 次回訪問時も引き継ぐ。
const FILTERS_COLLAPSED_KEY = "pokemonTcgFiltersCollapsed";

function bindFiltersToggle() {
  const btn = document.getElementById("toggle-filters");
  const panel = document.getElementById("filters-panel");
  if (!btn || !panel) return;

  // 開いている間はシェブロンを上向き(▴、クリックでたたむ)、閉じている間は
  // 下向き(▾、クリックで開く)にする、一般的なアコーディオンの向きに合わせる。
  // 回転アニメーションは使わず、文字自体を差し替える。
  function applyState(collapsed) {
    panel.classList.toggle("hidden", collapsed);
    btn.textContent = collapsed ? "▾" : "▴";
  }

  let collapsed = false;
  try {
    collapsed = localStorage.getItem(FILTERS_COLLAPSED_KEY) === "true";
  } catch {
    // localStorageが使えない環境では既定(開いた状態)のまま
  }
  applyState(collapsed);

  btn.addEventListener("click", () => {
    const nowCollapsed = !panel.classList.contains("hidden");
    applyState(nowCollapsed);
    try {
      localStorage.setItem(FILTERS_COLLAPSED_KEY, String(nowCollapsed));
    } catch {
      // localStorageが使えない環境では保存をあきらめる
    }
  });
}

// 一覧・相場ランキング・デッキ作成の3画面で共有する、絞り込みチェックボックスの
// 3状態切り替え(未選択→含める→除外→未選択)。除外中は checkbox.dataset.exclude="1"
// を立て、見た目(チェックボックスの色・ラベルの赤字取り消し線)はCSS側で表現する。
//
// 注意: チェックボックスは"click"イベントが発火する前に既にネイティブの
// checked切り替えが適用済み(pre-click activation)なので、ハンドラ内で読む
// checkbox.checkedは「クリック後の新しい値」。preventDefault()でこれを打ち消すと、
// click後に"canceled activation steps"が走ってJS側でcheckedに入れた値ごと
// クリック前の値へ巻き戻されてしまい、含める(チェック)状態に一切到達できなくなる
// バグがあった(実際に発生していたのはこれ)。そのためpreventDefaultは使わず、
// ネイティブのcheckedトグルをそのまま3状態の一部として利用する形に直している。
function bindTriStateFilterCheckbox(checkbox, onChange) {
  checkbox.addEventListener("click", () => {
    if (checkbox.dataset.exclude === "1") {
      // 除外 -> 未選択(ネイティブ側で既にchecked=falseになっている)
      checkbox.dataset.exclude = "";
    } else if (checkbox.checked) {
      // 未選択 -> 含める(ネイティブ側で既にchecked=trueになっている)
      checkbox.dataset.exclude = "";
    } else {
      // 含める -> 除外(ネイティブ側でchecked=falseに戻ってしまうため、trueに戻す)
      checkbox.checked = true;
      checkbox.dataset.exclude = "1";
    }
    const label = checkbox.closest("label");
    if (label) label.classList.toggle("filter-exclude", checkbox.dataset.exclude === "1");
    onChange();
  });
}

// 指定した絞り込みリスト(listId)内のチェックボックスから、含める値/除外する値を集める。
function getFilterSelection(listId) {
  const include = [];
  const exclude = [];
  for (const el of document.querySelectorAll(`#${listId} input`)) {
    if (el.dataset.exclude === "1") exclude.push(el.value);
    else if (el.checked) include.push(el.value);
  }
  return { include, exclude };
}

// カードの値一覧(例: レアリティなら["SR"])が、絞り込み条件(含める/除外)を満たすか。
// 除外指定した値が1つでも含まれていれば不採用。含める指定がある場合はそのいずれかを
// 持っている必要がある(何も指定が無ければ素通り)。
function matchesFilterSelection(cardValues, selection) {
  if (selection.exclude.some((v) => cardValues.includes(v))) return false;
  if (selection.include.length > 0 && !selection.include.some((v) => cardValues.includes(v))) return false;
  return true;
}

// バッジに表示する選択数(含める+除外の合計)。
function filterSelectionCount(listId) {
  const { include, exclude } = getFilterSelection(listId);
  return include.length + exclude.length;
}

// リセット時に3状態の状態(exclude属性・ラベルの赤字クラス)もまとめて解除する。
function resetTriStateCheckbox(checkbox) {
  checkbox.checked = false;
  checkbox.dataset.exclude = "";
  const label = checkbox.closest("label");
  if (label) label.classList.remove("filter-exclude");
}

// 収録パックフィルタ: 「パック」(CT-P、拡張パック本体)→「デッキ」(CT-D、構築済み
// デッキ)→「プロモーション」(それ以外、PRカードや誌上付録など)の3グループに分ける。
// パック/デッキは名前に埋め込まれたCT番号(CT-P01, CT-D02 等)の順で確実に並べられる。
// プロモーションはそのような通し番号が無く、公式データにも発売日がほとんど入って
// いない(128パック中115件がnull)ため、素直に五十音順にする。
const PACK_GROUP_ORDER = ["pack", "deck", "promo"];
const PACK_GROUP_LABELS = { pack: "パック", deck: "デッキ", promo: "プロモーション" };
const CT_NUMBER_PATTERN = /^CT-[A-Z](\d+)/;

function packGroupFor(packValue) {
  if (/^CT-D/.test(packValue)) return "deck";
  if (/^CT-P/.test(packValue)) return "pack";
  return "promo";
}

function ctNumber(packValue) {
  const m = packValue.match(CT_NUMBER_PATTERN);
  return m ? Number(m[1]) : Infinity;
}

function sortPackValues(values) {
  values.sort((a, b) => {
    const ga = packGroupFor(a);
    const gb = packGroupFor(b);
    if (ga !== gb) return PACK_GROUP_ORDER.indexOf(ga) - PACK_GROUP_ORDER.indexOf(gb);
    if (ga === "promo") return a.localeCompare(b, "ja");
    const na = ctNumber(a);
    const nb = ctNumber(b);
    return na !== nb ? na - nb : a.localeCompare(b, "ja");
  });
}

// サイト名(平均系列を除いた素の名前)ごとに色を固定する。
// 以前はカード内での出現順で色を割り当てていたため、同じサイトでもカードによって
// 別の色になってしまい見分けにくかった。既知のサイトは固定色、未知のサイトが
// 出てきた場合はページ内で最初に割り当てた色を使い回す。
const SITE_COLOR_MAP = {
  "駿河屋": "#2f6fed",
  "カードラボ": "#e0592a",
  "竜のしっぽ": "#2fa84f",
  "わいTV": "#c9781f",
  "カードラッシュ": "#c0392b",
};
const FALLBACK_SITE_COLORS = ["#a83fd1", "#d4a72c", "#1d9e9e"];
const fallbackSiteColorAssignments = {};

function baseSiteName(site) {
  return site.endsWith("(平均)") ? site.slice(0, -"(平均)".length) : site;
}

// 駿河屋アフィリエイト(Smart Biz Affiliate)のリンク生成。
// user_id=固定のアフィリエイターID、goods_url=転送先URLをエンコードしたもの、という
// 仕組みなので、カードごとの検索結果URLを組み立てて渡せば全カード分を自動生成できる。
const SURUGAYA_AFFILIATE_USER_ID = "5367";

function surugaSearchUrl(cardNum) {
  const query = `ポケモンカードゲーム ${cardNum}`;
  return `https://www.suruga-ya.jp/search?category=&search_word=${encodeURIComponent(query)}`;
}

function surugaAffiliateUrl(cardNum) {
  const target = surugaSearchUrl(cardNum);
  return `https://affiliate.suruga-ya.jp/modules/af/af_jump.php?user_id=${SURUGAYA_AFFILIATE_USER_ID}&goods_url=${encodeURIComponent(target)}`;
}

// 駿河屋以外はアフィリエイト提携が無いため、素の検索ページへのリンクのみ設置する
// (「PR」表記は付けない=金銭的な結びつきが無いことを景表法上も正しく反映する)。
// カードラボ・竜のしっぽはカード番号そのままでサイト内検索がヒットすることを確認済み。
// メルカードは内部管理番号が独自体系のため、カード番号ではなくカード名で検索する。
// フルアヘッド(MakeShop)はページ内の検索フォーム自体はPOST専用だが、隠しフィールド名
// (name="search")と同じ名前でGETパラメータを渡せば同じ検索結果が得られることを確認済み。
// まんぞく屋(EC-CUBE)もカード番号そのままでサイト内検索がヒットすることを確認済み。
// トレカバースはわいTVと同じく内部の「型番」表記が独自体系のため、カード名で検索する。
function cardLaboSearchUrl(cardNum) {
  return `https://www.c-labo-online.jp/product-list/?keyword=${encodeURIComponent(cardNum)}`;
}

function ryuunoshippoSearchUrl(cardNum) {
  return `https://www.ryuunoshippo.com/product-list?keyword=${encodeURIComponent(cardNum)}`;
}

// わいTVはカード番号(pack_code + 型番)そのままでサイト内検索がヒットすることを確認済み。
function waitvSearchUrl(cardNum) {
  return `https://www.cardshop-waitv.net/product-list/5?keyword=${encodeURIComponent(cardNum)}`;
}

// カードラッシュはcard_prints.cardrush_urlに商品詳細ページのURLがそのまま入っている
// (cardrush.media側のJSONに商品ページURLが埋め込まれているため、検索ではなく直リンク)。
// URLが無い(詳細ページ未取得)場合はcardrush.mediaの一覧検索にフォールバックする。
function cardrushSearchUrl(cardName) {
  return `https://cardrush.media/pokemon/cards?searchable_name=${encodeURIComponent(cardName || "")}`;
}

// メルカリアンバサダーのリンク生成。検索結果URLに afid= を足すだけで
// アフィリエイトリンクになる仕組み(実際にメルカリアンバサダーの管理画面で
// 生成して確認済み)。メルカリは単品のカード番号での検索ができず、他サイトのように
// 「最安値○○円」という自動比較はできないため、サイト別最安値の表には載せず、
// 別枠の「🔍メルカリで価格を確認する」ボタンとして独立させる(mercariButtonHtml参照)。
const MERCARI_AFFILIATE_ID = "8969530097";

function mercariAffiliateUrl(query) {
  return `https://jp.mercari.com/search?afid=${MERCARI_AFFILIATE_ID}&keyword=${encodeURIComponent(query)}`;
}

// メルカリの「🔍価格を確認する」ボタン(HTML文字列)を返す。サイト別最安値の表とは
// 別枠の要素として、呼び出し側で表のすぐ下などに追加してもらう想定。
// 検索ワードはカード名+レアリティ+card_id(例: "江戸川コナン SR 0001")。
function mercariButtonHtml(cardName, cardId, cardRarity) {
  if (!cardName) return "";
  const query = `${cardName} ${cardId || ""} ${cardRarity || ""}`.replace(/\s+/g, " ").trim();
  return `<a class="mercari-check-btn" href="${mercariAffiliateUrl(query)}" target="_blank" rel="nofollow noopener sponsored">🔍 メルカリで価格を確認する <span class="pr-label">PR</span></a>`;
}

// Amazonアソシエイトのトラッキングタグ。登録が済んでタグが分かったらここに入れる
// (未設定の間は素の検索リンク=アフィリエイトなし)。
const AMAZON_ASSOCIATE_TAG = "conantcgmarke-22";

function amazonCardSearchUrl(query) {
  const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(query)}`;
  return AMAZON_ASSOCIATE_TAG ? `${url}&tag=${AMAZON_ASSOCIATE_TAG}` : url;
}

// Amazonの「🔍価格を確認する」ボタン(HTML文字列)。カード名+card_id+レアリティで
// 検索する(例: "灰原哀 1067 R")。
function amazonButtonHtml(cardName, cardId, cardRarity) {
  if (!cardName) return "";
  const query = `${cardName} ${cardId || ""} ${cardRarity || ""}`.replace(/\s+/g, " ").trim();
  return `<a class="amazon-check-btn" href="${amazonCardSearchUrl(query)}" target="_blank" rel="nofollow noopener sponsored">🔍 Amazonで価格を確認する <span class="pr-label">PR</span></a>`;
}

const RAKUTEN_AFFILIATE_ID = "567cd45a.2625f6eb.567cd45b.7e49c506";

function rakutenCardSearchUrl(query) {
  const url = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(query)}/`;
  if (!RAKUTEN_AFFILIATE_ID) return url;
  return `https://hb.afl.rakuten.co.jp/hgc/${RAKUTEN_AFFILIATE_ID}/?pc=${encodeURIComponent(url)}`;
}

// 楽天市場の「🔍価格を確認する」ボタン(HTML文字列)。カード名+card_id+レアリティで
// 検索する(例: "灰原哀 1067 RP")。
function rakutenButtonHtml(cardName, cardId, cardRarity) {
  if (!cardName) return "";
  const query = `${cardName} ${cardId || ""} ${cardRarity || ""}`.replace(/\s+/g, " ").trim();
  return `<a class="rakuten-check-btn" href="${rakutenCardSearchUrl(query)}" target="_blank" rel="nofollow noopener sponsored">🔍 楽天市場で価格を確認する <span class="pr-label">PR</span></a>`;
}

// メルカリ・Amazon・楽天市場の確認ボタンをまとめて返す(呼び出し側は1箇所差し込むだけで済む)。
function purchaseButtonsHtml(cardName, cardId, cardRarity) {
  return `<div class="purchase-buttons">${mercariButtonHtml(cardName, cardId, cardRarity)}${amazonButtonHtml(cardName, cardId, cardRarity)}${rakutenButtonHtml(cardName, cardId, cardRarity)}</div>`;
}

// サイト名 -> (cardNum, cardName) => 検索/アフィリエイトURL、の対応表。
// 駿河屋のみアフィリエイトリンク+「PR」表記、他はアフィリエイト無しの素の検索リンク。
const SITE_LINK_BUILDERS = {
  "駿河屋": { url: (cardNum) => surugaAffiliateUrl(cardNum), pr: true },
  "カードラボ": { url: (cardNum) => cardLaboSearchUrl(cardNum), pr: false },
  "竜のしっぽ": { url: (cardNum) => ryuunoshippoSearchUrl(cardNum), pr: false },
  "わいTV": { url: (cardNum) => waitvSearchUrl(cardNum), pr: false },
  "カードラッシュ": {
    url: (cardNum, cardName, cardRarity, cardrushUrl) => cardrushUrl || cardrushSearchUrl(cardName),
    pr: false,
    requiresDirectUrlOrName: true,
  },
};

function colorForSite(site) {
  const base = baseSiteName(site);
  if (SITE_COLOR_MAP[base]) return SITE_COLOR_MAP[base];
  if (!fallbackSiteColorAssignments[base]) {
    const idx = Object.keys(fallbackSiteColorAssignments).length % FALLBACK_SITE_COLORS.length;
    fallbackSiteColorAssignments[base] = FALLBACK_SITE_COLORS[idx];
  }
  return fallbackSiteColorAssignments[base];
}

let commonPrices = {};
let siteLatestDay = {};

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(set) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...set]));
}

function isFavorite(cardId) {
  return loadFavorites().has(cardId);
}

function toggleFavorite(cardId) {
  const favs = loadFavorites();
  if (favs.has(cardId)) {
    favs.delete(cardId);
  } else {
    favs.add(cardId);
  }
  saveFavorites(favs);
  return favs.has(cardId);
}

// ポケモン1枚が持ちうるテキスト(特性・わざ1〜4・グッズ/サポート等の効果文)を
// 表示用に1つのまとまったテキストへ組み立てる。技のダメージ表記は
// "{わざ名} {エネルギー} {ダメージ}\n{説明}" の形にする。
function moveLines(card, prefix) {
  const name = card[`${prefix}_move`];
  if (!name) return null;
  const energy = card[`${prefix}_move_energy`] || "";
  const damage = card[`${prefix}_move_damage`] || "";
  const desc = card[`${prefix}_move_description`] || "";
  const header = [name, energy, damage].filter(Boolean).join("  ");
  return [header, desc].filter(Boolean).join("\n");
}

function abilityText(card) {
  const parts = [];
  if (card.ability) {
    const label = card.ability_category || "特性";
    parts.push(`【${label}】${card.ability}\n${card.ability_description || ""}`.trim());
  }
  for (const prefix of ["first", "second", "third", "special"]) {
    const line = moveLines(card, prefix);
    if (line) parts.push(line);
  }
  if (card.special_rule) parts.push(card.special_rule);
  if (card.description) parts.push(card.description);
  return parts.filter(Boolean).join("\n\n");
}

// 並び替えの共通ロジック(index/ranking/deckで共有)。sortOrderは"id_asc"のような
// "フィールド名_asc|desc"形式。値が無いカード(イベント等でAP/LPが無い場合等)は、
// 昇順/降順に関わらず常に末尾に回す。getValue(item, field)で並び替え対象を取り出す。
function sortByOrder(items, sortOrder, getValue) {
  const [field, direction] = sortOrder.split("_");
  const sorted = [...items];
  sorted.sort((a, b) => {
    const av = getValue(a, field);
    const bv = getValue(b, field);
    const aMissing = av === null || av === undefined;
    const bMissing = bv === null || bv === undefined;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    return direction === "asc" ? av - bv : bv - av;
  });
  return sorted;
}

// カード配列(id/level/ap/lp)向けのsortByOrderラッパー。
function sortCards(cards, sortOrder) {
  return sortByOrder(cards, sortOrder, (card, field) => (field === "id" ? card.id : card[field]));
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// GitHub Pagesはdata/*.jsonにCache-Control: max-age=600を付けてくるため、更新直後
// でも最大10分ブラウザに古いデータがキャッシュされ続けてしまう(実際に「データが
// 最新にならない」問い合わせの原因になった)。ページ読み込みのたびに違うURLとして
// 扱わせ、キャッシュを回避するため毎回タイムスタンプを付けて取得する。
function fetchFresh(url) {
  return fetch(`${url}?t=${Date.now()}`);
}

// data/meta.jsonには生成日時に加えて、サイトごとの直近取得日(YYYY-MM-DD、
// ビルド時にexport_static.pyのdb全体を見て集計済み)も入っている。ページ内で
// 複数回呼ばれても実際のfetchは1回だけで済むよう結果をキャッシュする。
let cachedMeta = null;

async function loadSiteMeta() {
  if (cachedMeta) return cachedMeta;
  const res = await fetchFresh("data/meta.json");
  cachedMeta = await res.json();
  siteLatestDay = cachedMeta.site_latest_day || {};
  return cachedMeta;
}

// 一覧系ページ(トップ/ランキング/デッキ作成/お気に入り)向け。カードごとの
// 価格全履歴(重い)ではなく、カードごとの最新相場だけをまとめた軽量ファイル
// (data/prices_latest.json)を読む。全履歴が必要なモーダル/カード詳細ページは
// 別途fetchPriceHistory()でカード単位に遅延取得する。
async function loadCardData() {
  const [cardsRes, pricesRes] = await Promise.all([
    fetchFresh("data/cards.json"),
    fetchFresh("data/prices_latest.json"),
    loadSiteMeta(),
  ]);
  const cards = await cardsRes.json();
  commonPrices = await pricesRes.json();
  return cards;
}

// 一覧タイルの相場表示用。data/prices_latest.jsonはビルド時点で既に
// 「サイト自身の直近取得日に記録が無ければ除外」まで済ませた値なので、
// ここではそのまま読むだけでよい(モーダル/詳細ページの生履歴からの
// 計算はpooledAveragePriceを使う。cf. avgHighlightHtml)。
function pooledAveragePriceFromLatest(cardId) {
  const entry = commonPrices[String(cardId)];
  return entry ? entry.pooled_avg : null;
}

// カード1枚分の価格履歴全件(data/prices/{id}.json)をクリック時に遅延取得する。
// 同じカードを同じページ内で何度開いてもfetchは1回だけで済むようキャッシュする。
const priceHistoryCache = new Map();

function fetchPriceHistory(cardId) {
  if (!priceHistoryCache.has(cardId)) {
    priceHistoryCache.set(
      cardId,
      fetchFresh(`data/prices/${cardId}.json`)
        .then((res) => (res.ok ? res.json() : []))
        .catch(() => [])
    );
  }
  return priceHistoryCache.get(cardId);
}

// ヘッダーに「最終更新: 2026/7/29 3:05」を表示する(自動更新がいつ効いたか一目で分かるように)。
// 対応する要素(#last-updated)が無いページでは何もしない。
async function renderLastUpdated() {
  const el = document.getElementById("last-updated");
  if (!el) return;
  try {
    const meta = await loadSiteMeta();
    el.textContent = `最終更新: ${formatDateTimeFull(meta.generated_at)}`;
  } catch {
    // meta.jsonが無い/読めない場合は何も表示しない
  }
}

// カードタイルのDOM要素を作る。お気に入り星をクリックしても詳細モーダルは開かない。
// タイルは<a href="card/{id}.html">として作る(通常クリックは今まで通り
// モーダルを開く。Ctrl/Cmd/Shiftクリックや中クリックはブラウザ標準の
// 「新しいタブで開く」を素通しし、実際にcard/{id}.htmlへ遷移させる)。
// 検索エンジンのクロールで個別ページが発見されやすくなる(内部リンク)のと、
// 右クリックの「リンクをコピー」で共有用URLを取れるようにするための変更。
// trueを返した場合だけ呼び出し側でopenModal()する(=通常の左クリックだった)。
function shouldOpenModalInstead(e) {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return false;
  e.preventDefault();
  return true;
}

function createCardTile(card, onFavoriteToggle) {
  const tile = document.createElement("a");
  tile.className = "card-tile";
  tile.href = `card/${card.id}.html`;

  const star = document.createElement("button");
  star.type = "button";
  star.className = "favorite-star" + (isFavorite(card.id) ? " active" : "");
  star.textContent = isFavorite(card.id) ? "★" : "☆";
  star.title = "お気に入り(価格チェック対象)に登録/解除";
  star.addEventListener("click", (e) => {
    // タイル自体が<a>タグになったため、stopPropagationだけでは(独自の
    // クリックハンドラは止まっても)ブラウザ標準のリンク遷移までは止まらない。
    // 星を押したときにcard/{id}.htmlへ飛んでしまっていた実際のバグの修正。
    e.preventDefault();
    e.stopPropagation();
    const nowFav = toggleFavorite(card.id);
    star.textContent = nowFav ? "★" : "☆";
    star.classList.toggle("active", nowFav);
    if (onFavoriteToggle) onFavoriteToggle(card, nowFav);
  });

  const img = document.createElement("img");
  img.src = card.image_url || "";
  img.alt = card.name;
  img.loading = "lazy";

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = card.name;

  const sub = document.createElement("div");
  sub.className = "sub";
  const price = pooledAveragePriceFromLatest(card.id);
  const priceText = price !== null ? `${price.toLocaleString()}円` : "-";
  sub.innerHTML = `<span class="sub-meta">${escapeHtml(card.rarity || "")} / ${escapeHtml(card.element || "")}</span><span class="sub-price">${escapeHtml(priceText)}</span>`;

  tile.append(star, img, name, sub);
  tile.addEventListener("click", (e) => {
    if (shouldOpenModalInstead(e)) openModal(card);
  });
  return tile;
}

function openModal(card) {
  document.getElementById("modal-image").src = card.image_url || "";
  document.getElementById("modal-image").alt = card.name;

  const fields = [
    ["カード番号", card.card_num],
    ["種類", card.category],
    ["タイプ", card.element],
    ["HP", card.hp],
    ["進化段階", card.evolution_rank],
    ["レアリティ", card.rarity],
    ["収録パック", card.pack],
    ["弱点", card.week_point],
    ["抵抗力", card.resistance],
    ["にげる", card.escape_cost],
  ];

  const infoEl = document.getElementById("modal-info");
  infoEl.innerHTML = fields
    .filter(([, v]) => v !== null && v !== "" && v !== undefined)
    .map(([label, v]) => `<div class="field"><span class="label">${label}:</span><span>${escapeHtml(String(v))}</span></div>`)
    .join("");

  const abilityBox = document.createElement("div");
  abilityBox.className = "ability";
  abilityBox.textContent = abilityText(card) || "(なし)";
  infoEl.appendChild(abilityBox);

  if (card.flavor_text) {
    const flavor = document.createElement("div");
    flavor.className = "field";
    flavor.style.marginTop = "6px";
    flavor.innerHTML = `<span>${escapeHtml(card.flavor_text)}</span>`;
    infoEl.appendChild(flavor);
  }

  // モーダルを先に表示してからグラフを描く(非表示中はcanvasのclientWidthが0になり、
  // 解像度を正しく測れないため)。
  document.getElementById("modal-overlay").classList.remove("hidden");
  document.body.classList.add("modal-open");

  // 価格履歴(全期間分)はカード単位のファイルをここで初めて取得する(一覧読み込み時に
  // 全カード分をまとめて持っておくと重すぎるため)。取得が終わるまでの間、直前に
  // 別カードを開いていた場合の古い表示が一瞬残らないよう読み込み中の表示にしておく。
  const statsEl = document.getElementById("modal-price-stats");
  if (statsEl) statsEl.textContent = "読み込み中...";
  fetchPriceHistory(card.id).then((history) => {
    renderPriceSection(card.id, card.card_num, card.name, card.rarity, card.cardrush_url, history);
  });

  // モーダル右上のお気に入り星。カード一覧タイルの星と同じ登録先(localStorage)を使う。
  // お気に入り一覧(compare.html)側では、モーダルから解除したら一覧にも反映したいので、
  // ページ側が任意で window.onModalFavoriteToggle を定義していれば呼び出す。
  const favBtn = document.getElementById("modal-favorite");
  if (favBtn) {
    const syncFavBtn = () => {
      const fav = isFavorite(card.id);
      favBtn.textContent = fav ? "★" : "☆";
      favBtn.classList.toggle("active", fav);
    };
    syncFavBtn();
    favBtn.onclick = (e) => {
      e.stopPropagation();
      toggleFavorite(card.id);
      syncFavBtn();
      if (typeof window.onModalFavoriteToggle === "function") window.onModalFavoriteToggle(card);
    };
  }
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function bindModalEvents() {
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

// サイトごとの最新の最安値を返す。{ site: {price, recorded_at, sample_count}|null }
// そのサイト自身の直近の巡回日(siteLatestDay、data/meta.jsonでビルド時点に
// 全カード横断で集計済み・"YYYY-MM-DD"形式)に、このカードの記録が無ければ、
// 売り切れ等でその回は対象から外れたとみなし結果から除く(-表示になる)。
// サイト単位の基準なので、他サイトに一度もデータが無いカードでも正しく判定できる。
function latestPriceBySite(history) {
  const bySite = {};
  for (const h of history) {
    const base = baseSiteName(h.site);
    if (!bySite[base] || h.recorded_at > bySite[base].recorded_at) {
      bySite[base] = { price: h.price, recorded_at: h.recorded_at, sample_count: h.sample_count };
    }
  }
  for (const base of Object.keys(bySite)) {
    const latestDay = siteLatestDay[base];
    if (latestDay && bySite[base].recorded_at.slice(0, 10) !== latestDay) {
      delete bySite[base];
    }
  }
  return bySite;
}

// サイト別の最安値を表形式(HTML文字列)で返す。最安値が一番安いサイトを🏆で強調する。
// データが無いサイトも(-表示で)必ず一覧に出す。「載っていない」のか「未取得」なのかを
// 区別できるようにするため。
// cardNum/cardNameを渡すと、SITE_LINK_BUILDERSにあるサイト名をそのカードの検索
// ページへのリンクにする。駿河屋のみアフィリエイトリンク+「PR」表記、他は素の
// 検索リンク(アフィリエイト提携が無いサイトに「PR」を付けると景表法上不正確なため)。
// メルカリは価格の自動取得ができないため、この表には含めない(mercariButtonHtml参照)。
function siteSummaryTableHtml(history, cardNum, cardName, cardRarity, cardBusinessId) {
  const bySite = latestPriceBySite(history);
  const allSites = new Set([...Object.keys(SITE_COLOR_MAP), ...Object.keys(bySite)]);
  const entries = [...allSites].map((site) => [site, bySite[site] || null]);
  if (entries.length === 0) return "";

  entries.sort((a, b) => {
    const pa = a[1] ? a[1].price : Infinity;
    const pb = b[1] ? b[1].price : Infinity;
    return pa - pb;
  });

  const rows = entries
    .map(([site, stats], i) => {
      const color = colorForSite(site);
      const crown = i === 0 && stats ? "🏆" : "";
      const minText = stats ? `${stats.price}円` : "-";
      const linkBuilder = SITE_LINK_BUILDERS[site];
      const canLink = linkBuilder && (linkBuilder.requiresDirectUrlOrName ? (cardBusinessId || cardName) : cardNum);
      const nameHtml = canLink
        ? `<a href="${linkBuilder.url(cardNum, cardName, cardRarity, cardBusinessId)}" target="_blank" rel="nofollow noopener${linkBuilder.pr ? " sponsored" : ""}">${escapeHtml(site)}</a>${linkBuilder.pr ? ' <span class="pr-label">PR</span>' : ""}`
        : escapeHtml(site);
      return `<tr>
        <td><span class="site-swatch" style="background:${color}"></span>${nameHtml}${crown}</td>
        <td>${minText}</td>
      </tr>`;
    })
    .join("");

  return `<table class="price-site-table">
    <thead><tr><th>サイト</th><th>最安値</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// 「相場」として全ページ共通で使う数値: 各サイトの現在の最安値を単純平均する。
// 例: 駿河屋の最安値700円・カードラボの最安値750円・竜のしっぽの最安値720円なら、
//     (700+750+720)/3 = 723円。出品数による重み付けはしない。
function pooledAveragePrice(history) {
  const bySite = latestPriceBySite(history);
  const prices = Object.values(bySite).map((s) => s.price).filter((p) => p != null);
  if (prices.length === 0) return null;
  return Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length);
}

// 「このカードの相場」を大きく強調表示するHTML文字列を返す(各サイト最安値の単純平均)。
function avgHighlightHtml(history) {
  const avg = pooledAveragePrice(history);
  if (avg === null) return "";

  const mins = Object.values(latestPriceBySite(history)).map((s) => s.price).filter((p) => p != null);
  const range = mins.length > 1
    ? `<span class="price-avg-range">(最安 ${Math.min(...mins)}円 〜 ${Math.max(...mins)}円)</span>`
    : "";

  return `<div class="price-avg-highlight">相場 <span class="price-avg-value">${avg}円</span>${range}</div>`;
}

// 「最新取得日時」の行(HTML文字列)を返す。サイト別テーブルとひとまとめにして表示するため
// avgHighlightHtmlとは分けている。
function latestDateHtml(history) {
  const latestDate = [...history].sort((a, b) => (a.recorded_at > b.recorded_at ? 1 : -1)).at(-1).recorded_at;
  return `<div class="price-avg-date">最新取得日時: ${formatDateTimeFull(latestDate)}</div>`;
}

// カード1件分の価格統計(相場の強調表示 + 最新取得日時 + サイト別最安値の表)を
// まとめてHTML文字列で返す(表とグラフを分けて配置できないページ向け)。
function buildPriceStatsHtml(history, cardNum, cardName, cardRarity, cardrushUrl) {
  const table = siteSummaryTableHtml(history, cardNum, cardName, cardRarity, cardrushUrl);
  const buttons = purchaseButtonsHtml(cardName, cardNum, cardRarity);
  return `${avgHighlightHtml(history)}${latestDateHtml(history)}${table}${buttons}`;
}

function renderPriceSection(cardPk, cardNum, cardName, cardRarity, cardrushUrl, history) {
  history = history || [];
  const statsEl = document.getElementById("modal-price-stats");
  const tableEl = document.getElementById("modal-price-table");
  const canvas = document.getElementById("price-chart");
  const emptyEl = document.getElementById("price-empty");
  const periodTabs = document.getElementById("period-tabs");

  if (history.length === 0) {
    statsEl.textContent = "";
    if (tableEl) tableEl.innerHTML = "";
    canvas.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    if (periodTabs) periodTabs.classList.add("hidden");
    return;
  }

  canvas.classList.remove("hidden");
  emptyEl.classList.add("hidden");

  if (tableEl) {
    statsEl.innerHTML = `${avgHighlightHtml(history)}${latestDateHtml(history)}`;
    tableEl.innerHTML = `${siteSummaryTableHtml(history, cardNum, cardName, cardRarity, cardrushUrl)}${purchaseButtonsHtml(cardName, cardNum, cardRarity)}`;
  } else {
    statsEl.innerHTML = buildPriceStatsHtml(history, cardNum, cardName, cardRarity, cardrushUrl);
  }

  // モーダル内は既定で7日表示。全期間/30日タブでその場で切り替えられる。
  if (periodTabs) {
    periodTabs.classList.remove("hidden");
    const tabs = periodTabs.querySelectorAll(".period-tab");
    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.days === "7");
      tab.onclick = () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        drawPriceChart(canvas, history, Number(tab.dataset.days) || null);
      };
    });
  }

  drawPriceChart(canvas, history, 7);
}

// ISO日時文字列を "7/21" のような日付のみの表示に変換する(グラフの軸ラベル用。
// 日単位でまとめて表示するため時刻までは出さない)
function formatDateLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 実行時刻(recorded_at)を「実行日」単位のキーに丸める。駿河屋・カードラボ・竜のしっぽの
// スクレイパーは同じ日次バッチでも数分〜十数分ずれた時刻に完了するため、そのままだと
// グラフのX軸上で「同じ日の更新」のはずの点がずれて表示されてしまう。日単位のキーに
// まとめることで、同じ日に取得した点は同じX位置に揃うようにする。
function dayKey(iso) {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

// dayKeyの配列から、最初〜最後の日までを1日も欠かさず埋めた連続した日付配列を作る。
// データが無い日を詰めて隣の日と同じ間隔で描画してしまうと、グラフのX軸上で
// 「何日分の空白か」が分からなくなってしまうため、グラフのX軸には必ず全ての
// 暦日を並べ、データが無い日はその日の位置に点が無いだけ、という形にする。
function allDaysBetween(dayKeys) {
  if (dayKeys.length === 0) return [];
  const sorted = [...dayKeys].sort();
  const start = new Date(sorted[0]);
  const end = new Date(sorted[sorted.length - 1]);
  const result = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    result.push(new Date(d).toISOString());
  }
  return result;
}

// ISO日時文字列を "2026/7/21 14:27" のような年まで含む表示に変換する(統計テキスト用)
function formatDateTimeFull(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

// historyを直近days日分だけに絞り込む(daysが無ければ全期間そのまま)。
// 「直近」は現在時刻ではなく、そのカードの最新データ時点を基準にする
// (自動更新が数日止まっていても「データが無い」と表示されるのを防ぐため)。
function filterHistoryByDays(history, days) {
  if (!days || history.length === 0) return history;
  const latest = Math.max(...history.map((p) => new Date(p.recorded_at).getTime()));
  const cutoff = latest - days * 24 * 60 * 60 * 1000;
  return history.filter((p) => new Date(p.recorded_at).getTime() >= cutoff);
}

// 同じサイト・同じ日に複数の取得ポイントがある場合(手動での再実行など)、
// 同じX位置(日)に2点存在してグラフの線がジグザグに折れて見えてしまうため、
// サイトごとに1日1点(その日の最新値)だけになるよう間引く。
function dedupeLatestPerSiteDay(points) {
  const latestByKey = new Map();
  for (const p of points) {
    const key = `${baseSiteName(p.site)}|${dayKey(p.recorded_at)}`;
    const existing = latestByKey.get(key);
    if (!existing || p.recorded_at > existing.recorded_at) latestByKey.set(key, p);
  }
  return [...latestByKey.values()];
}

// 「相場」(各サイト最安値の単純平均)の日次推移を返す。各サイトの最安値系列を日ごとに
// 1点にまとめたうえで、その日にデータがある全サイトの最安値を単純平均する
// (pooledAveragePriceの「最新1点だけ」版を、日ごとに算出したもの)。
function pooledAverageSeries(history) {
  const minPoints = dedupeLatestPerSiteDay(history.filter((p) => !p.site.endsWith("(平均)")));
  const byDay = new Map();
  for (const p of minPoints) {
    const day = dayKey(p.recorded_at);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(p);
  }
  const series = [];
  for (const points of byDay.values()) {
    const avg = points.reduce((sum, p) => sum + p.price, 0) / points.length;
    series.push({ recorded_at: points[0].recorded_at, price: Math.round(avg) });
  }
  series.sort((a, b) => (a.recorded_at > b.recorded_at ? 1 : -1));

  // サイトごとにクロール時刻がずれるため、直近の日はまだ一部のサイトしか取得できて
  // いないことがある。その日に取得できたサイトだけで単純平均すると、相場欄・表の
  // 最新値(latestPriceBySite=各サイトの直近有効価格を使う。売り切れ判定込み)と
  //食い違って、最後の1点だけ実態と関係なく急落/急騰して見えてしまう
  // (実際にわいTVを追加した直後、8/12はわいTVしか取得できておらず、その日だけの
  // 単純平均が120円になって相場欄の195円と食い違っていた)。最後の点だけは
  // pooledAveragePriceと同じ「現在有効な全サイトの直近価格」ベースに置き換える。
  if (series.length > 0) {
    const current = pooledAveragePrice(history);
    if (current !== null) {
      const latest = [...history].sort((a, b) => (a.recorded_at > b.recorded_at ? 1 : -1)).at(-1);
      series[series.length - 1] = { recorded_at: latest.recorded_at, price: current };
    }
  }

  return series;
}

const MARKET_LINE_COLOR = "#222";

function drawPriceChart(canvas, history, days) {
  // canvasの描画バッファ解像度をCSS表示サイズ(+devicePixelRatio)に合わせる。
  // これをしないと、CSSで拡大表示されたぶん線がぼやけて薄く見えてしまう
  // (canvas要素はwidth/height属性=描画解像度と、CSSサイズ=表示サイズが別物のため)。
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const limited = filterHistoryByDays(history, days);

  // グラフには各サイトの最安値の推移に加えて、各サイト最安値を単純平均した「相場」の
  // 推移も重ねて描く(数値としては avgHighlightHtml で強調表示済みだが、グラフでも
  // 推移を追えるようにしてほしいという要望に対応)。
  const shown = dedupeLatestPerSiteDay(limited.filter((p) => !p.site.endsWith("(平均)")));
  const pooledSeries = pooledAverageSeries(limited);

  const bySite = {};
  for (const point of shown) {
    const base = baseSiteName(point.site);
    bySite[base] = bySite[base] || [];
    bySite[base].push(point);
  }

  const dates = allDaysBetween([...shown, ...pooledSeries].map((p) => dayKey(p.recorded_at)));
  const prices = [...shown, ...pooledSeries].map((p) => p.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const pad = Math.max(10, Math.round((maxPrice - minPrice) * 0.1));
  const yMin = Math.max(0, minPrice - pad);
  const yMax = maxPrice + pad;

  const marginLeft = 45;
  const marginRight = 20;
  const marginBottom = 40;

  // サイトが増えて凡例が1行に収まらなくなった場合(サイト名が右端で切れて見えなくなる
  // 問題があった)、折り返して複数行にする。行数ぶんグラフ本体の開始位置を下にずらす
  // 必要があるため、軸やグラフ本体を描く前に凡例の行数を確定させておく。
  const legendItems = [];
  for (const base of Object.keys(bySite)) {
    legendItems.push({ site: base, color: colorForSite(base) });
  }
  if (pooledSeries.length > 0) {
    legendItems.push({ site: "相場", color: MARKET_LINE_COLOR });
  }

  ctx.font = "11px sans-serif";
  const legendGap = 30;
  const legendRowHeight = 16;
  const legendFirstRowY = 10;
  const legendRows = [[]];
  let legendX = marginLeft + 4;
  for (const item of legendItems) {
    const itemWidth = 11 + ctx.measureText(item.site).width;
    const currentRow = legendRows[legendRows.length - 1];
    if (legendX + itemWidth > w - marginRight && currentRow.length > 0) {
      legendRows.push([]);
      legendX = marginLeft + 4;
    }
    legendRows[legendRows.length - 1].push({ ...item, x: legendX });
    legendX += itemWidth + legendGap;
  }

  const margin = {
    left: marginLeft,
    right: marginRight,
    top: legendRows.length <= 1 ? legendFirstRowY : legendFirstRowY + legendRows.length * legendRowHeight - 6,
    bottom: marginBottom,
  };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;

  const xPos = (date) => margin.left + (dates.length <= 1 ? plotW / 2 : (dates.indexOf(date) / (dates.length - 1)) * plotW);
  const yPos = (price) => margin.top + plotH - ((price - yMin) / (yMax - yMin || 1)) * plotH;

  ctx.strokeStyle = "#ccc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH);
  ctx.stroke();

  ctx.fillStyle = "#888";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(String(yMax), margin.left - 6, margin.top);
  ctx.fillText(String(yMin), margin.left - 6, margin.top + plotH);
  ctx.textBaseline = "alphabetic";

  // ホバー時にツールチップで値を出すため、描画した各点の座標と内容を控えておく。
  const hitPoints = [];

  function drawSeries(points, color, label, { dashed = false, lineWidth = 2 } = {}) {
    if (points.length === 0) return;
    const sorted = [...points].sort((a, b) => (a.recorded_at > b.recorded_at ? 1 : -1));
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dashed ? [6, 4] : []);
    ctx.beginPath();
    sorted.forEach((p, i) => {
      const x = xPos(dayKey(p.recorded_at));
      const y = yPos(p.price);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    for (const p of sorted) {
      const x = xPos(dayKey(p.recorded_at));
      const y = yPos(p.price);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      hitPoints.push({ x, y, label, price: p.price, date: formatDateLabel(p.recorded_at) });
    }
  }

  for (const [base, points] of Object.entries(bySite)) {
    drawSeries(points, colorForSite(base), base);
  }

  // 相場(各サイト最安値の単純平均)は、サイト別の実勢価格と区別しやすいよう
  // 太めの点線で目立たせて重ねて描く。
  if (pooledSeries.length > 0) {
    drawSeries(pooledSeries, MARKET_LINE_COLOR, "相場", { dashed: true, lineWidth: 3 });
  }

  ctx.font = "11px sans-serif";
  legendRows.forEach((row, rowIndex) => {
    const y = legendFirstRowY + rowIndex * legendRowHeight;
    for (const { site, color, x } of row) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y - 2, 8, 8);
      ctx.fillStyle = "#555";
      ctx.textAlign = "left";
      ctx.fillText(site, x + 11, y + 6);
    }
  });

  // x軸に日付ラベル(取得日)を表示。重ならないよう間引くが、7日表示のときは
  // 最大でも7点しか無いため、間引かず全日ぶん表示する。
  const maxLabels = Math.max(2, Math.floor(plotW / 80));
  let labelIndices;
  if (days === 7 || dates.length <= maxLabels) {
    labelIndices = dates.map((_, i) => i);
  } else {
    labelIndices = [...new Set(
      Array.from({ length: maxLabels }, (_, i) => Math.round((i * (dates.length - 1)) / (maxLabels - 1)))
    )];
  }
  // ラベルを斜め(30度)に傾けて表示する。目盛りの少し右下から右肩下がりに伸ばす
  // (Excel等でよく見る向き)。左のY軸ラベルと重ならないよう、始点はメモリ位置。
  ctx.fillStyle = "#888";
  ctx.font = "10px sans-serif";
  ctx.textBaseline = "middle";
  for (const idx of labelIndices) {
    const date = dates[idx];
    const x = xPos(date);
    const y = margin.top + plotH + 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((30 * Math.PI) / 180);
    ctx.textAlign = "left";
    ctx.fillText(formatDateLabel(date), 0, 0);
    ctx.restore();
  }

  setupChartHover(canvas, hitPoints);
}

// 全グラフで使い回す単一のツールチップ要素(初回呼び出し時に1つだけ作る)。
let chartTooltipEl = null;
function getChartTooltip() {
  if (!chartTooltipEl) {
    chartTooltipEl = document.createElement("div");
    chartTooltipEl.className = "chart-tooltip";
    document.body.appendChild(chartTooltipEl);
  }
  return chartTooltipEl;
}

// canvas上のマウス位置に一番近い点(一定距離以内)を探し、ツールチップで
// 「サイト名: 価格円(日付)」を表示する。drawPriceChartが呼ばれるたびに
// hitPoints(点の座標一覧)は最新化されるが、イベントリスナー自体は
// canvasごとに1回だけ登録する(再登録による多重発火を防ぐため)。
function setupChartHover(canvas, hitPoints) {
  canvas._chartHitPoints = hitPoints;
  if (canvas._chartHoverBound) return;
  canvas._chartHoverBound = true;

  const tooltip = getChartTooltip();
  const HIT_RADIUS = 10;

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let nearest = null;
    let nearestDist = HIT_RADIUS;
    for (const p of canvas._chartHitPoints || []) {
      const dist = Math.hypot(p.x - mx, p.y - my);
      if (dist <= nearestDist) {
        nearest = p;
        nearestDist = dist;
      }
    }

    if (nearest) {
      tooltip.textContent = `${nearest.label}: ${nearest.price}円 (${nearest.date})`;
      tooltip.style.left = `${e.clientX + 12}px`;
      tooltip.style.top = `${e.clientY + 12}px`;
      tooltip.style.display = "block";
      canvas.style.cursor = "pointer";
    } else {
      tooltip.style.display = "none";
      canvas.style.cursor = "default";
    }
  });

  canvas.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
  });
}
