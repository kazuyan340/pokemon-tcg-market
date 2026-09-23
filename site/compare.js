let checkedCards = [];
let allCards = [];

// カードごとのしきい値(円)。{ cardId: { over: 数値, under: 数値 }, ... } の形でlocalStorageに保存する。
// over = この金額を超えたら強調、under = この金額を下回ったら強調。
const THRESHOLDS_KEY = "pokemonTcgPriceThresholds";

function loadThresholds() {
  try {
    const raw = localStorage.getItem(THRESHOLDS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveThreshold(cardId, key, value) {
  const thresholds = loadThresholds();
  const entry = { ...thresholds[cardId] };
  if (value === null) {
    delete entry[key];
  } else {
    entry[key] = value;
  }
  if (Object.keys(entry).length === 0) {
    delete thresholds[cardId];
  } else {
    thresholds[cardId] = entry;
  }
  localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(thresholds));
}

async function init() {
  allCards = await loadCardData();
  const ids = loadFavorites();
  checkedCards = allCards.filter((c) => ids.has(c.id));

  document.getElementById("clear-compare").addEventListener("click", () => {
    for (const card of [...checkedCards]) {
      toggleFavorite(card.id);
    }
    checkedCards = [];
    render();
  });

  // カード詳細モーダルの☆から解除された場合も、このページの一覧にすぐ反映する。
  window.onModalFavoriteToggle = () => {
    const currentIds = loadFavorites();
    checkedCards = allCards.filter((c) => currentIds.has(c.id));
    render();
  };

  bindModalEvents();
  bindNavMenuToggle();
  render();
  renderLastUpdated();
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function removeCard(cardId) {
  toggleFavorite(cardId);
  checkedCards = checkedCards.filter((c) => c.id !== cardId);
  render();
}


// しきい値の強調表示をboxに反映する。入力側で上回ったら(over)>下回ったら(under)の
// 関係を常に保証しているため、両方同時に成立することはない。
function applyThresholdHighlight(box, price, over, under) {
  box.classList.remove("over-threshold", "under-threshold");
  if (over !== null && price !== null && price > over) {
    box.classList.add("over-threshold");
  }
  if (under !== null && price !== null && price < under) {
    box.classList.add("under-threshold");
  }
}

// お気に入りは通常ごく少数(数枚〜数十枚)のため、カードごとの価格履歴全件
// (data/prices/{id}.json)をこのページを開いたタイミングでまとめて先読みする。
// 一覧系ページのように全カード分をまとめて持っておく必要は無い。
async function render() {
  const grid = document.getElementById("price-check-grid");
  const emptyMessage = document.getElementById("empty-message");
  grid.innerHTML = "";

  if (checkedCards.length === 0) {
    emptyMessage.classList.remove("hidden");
    return;
  }
  emptyMessage.classList.add("hidden");

  const thresholds = loadThresholds();
  const historyByCardId = new Map(
    await Promise.all(checkedCards.map(async (card) => [card.id, await fetchPriceHistory(card.id)]))
  );

  for (const card of checkedCards) {
    const box = document.createElement("div");
    box.className = "price-check-card";

    const history = historyByCardId.get(card.id) || [];
    const price = pooledAveragePriceFromLatest(card.id);
    const entry = thresholds[card.id] || {};
    const live = { over: entry.over ?? null, under: entry.under ?? null };

    const header = document.createElement("div");
    header.className = "price-check-header";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "compare-remove";
    removeBtn.textContent = "✕";
    removeBtn.title = "外す";
    removeBtn.addEventListener("click", () => removeCard(card.id));

    const img = document.createElement("img");
    img.src = card.image_url || "";
    img.alt = card.name;

    const info = document.createElement("div");
    info.className = "price-check-info";
    info.innerHTML = `
      <div class="name">${escapeHtml(card.name)}</div>
      <div class="sub">${escapeHtml(card.rarity || "")} / ${escapeHtml(card.element || "")} / ${escapeHtml(card.card_num || "")}</div>
    `;

    // 画像+名前部分をこのカードの詳細ページへの実リンクにする(index.html等の
    // タイルと同じ考え方)。通常クリックは今まで通りモーダルを開く。ページ全体を
    // <a>にすると通知ラインの入力欄などが入れ子になってしまうため、ここでは
    // クリックで開いていた画像+名前部分だけをリンクにする。
    const link = document.createElement("a");
    link.className = "price-check-link";
    link.href = `card/${card.id}.html`;
    link.append(img, info);
    link.addEventListener("click", (e) => {
      if (shouldOpenModalInstead(e)) openModal(card);
    });

    header.append(removeBtn, link);

    const stats = document.createElement("div");
    stats.className = "price-stats";
    stats.innerHTML = history.length === 0 ? "価格データがありません" : `${avgHighlightHtml(history)}${latestDateHtml(history)}`;

    // 「上回ったら」は「下回ったら」以下にできない、「下回ったら」は「上回ったら」以上に
    // できないよう、入力の時点でお互いの値を見て自動的に補正する(そもそも矛盾した組み合わせを
    // 作れないようにする)。
    function makeThresholdInput(key) {
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "100";
      input.placeholder = "例: 1000";
      if (entry[key] != null) input.value = entry[key];
      return input;
    }

    const overInput = makeThresholdInput("over");
    const underInput = makeThresholdInput("under");

    function updateConstraints() {
      overInput.min = live.under !== null ? live.under + 1 : 0;
      if (live.over !== null) {
        underInput.max = Math.max(0, live.over - 1);
      } else {
        underInput.removeAttribute("max");
      }
    }
    updateConstraints();

    function bindThresholdInput(key, input, otherKey, otherInput, clamp) {
      input.addEventListener("input", debounce(() => {
        let v = input.value === "" ? null : Number(input.value);
        const other = live[otherKey];
        if (v !== null && other !== null && !clamp.valid(v, other)) {
          v = clamp.fix(other);
          input.value = v;
        }
        saveThreshold(card.id, key, v);
        live[key] = v;
        updateConstraints();
        applyThresholdHighlight(box, price, live.over, live.under);
      }, 300));
    }

    bindThresholdInput("over", overInput, "under", underInput, {
      valid: (v, under) => v > under,
      fix: (under) => under + 1,
    });
    bindThresholdInput("under", underInput, "over", overInput, {
      valid: (v, over) => v < over,
      fix: (over) => Math.max(0, over - 1),
    });

    const overRow = document.createElement("label");
    overRow.className = "card-threshold-row";
    overRow.append("値上がり通知ライン(円): ", overInput);

    const underRow = document.createElement("label");
    underRow.className = "card-threshold-row";
    underRow.append("値下がり通知ライン(円): ", underInput);

    applyThresholdHighlight(box, price, live.over, live.under);

    const detailRow = document.createElement("div");
    detailRow.className = "price-detail-row";

    // 値上がり/値下がり通知ライン→表、の順で左側グループにまとめ、グラフと縦中央揃えの対象にする。
    const tableCol = document.createElement("div");
    tableCol.className = "price-table-col";
    const tableWrap = document.createElement("div");
    if (history.length > 0) {
      tableWrap.innerHTML = `${siteSummaryTableHtml(history, card.card_num, card.name, card.rarity, card.cardrush_url)}${purchaseButtonsHtml(card.name, card.card_num, card.rarity)}`;
    }
    tableCol.append(overRow, underRow, tableWrap);

    const chartCol = document.createElement("div");
    chartCol.className = "price-chart-col";
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 200;
    canvas.className = "price-check-canvas";
    chartCol.appendChild(canvas);

    detailRow.append(tableCol, chartCol);

    box.append(header, stats, detailRow);
    grid.appendChild(box);

    // canvasがDOMに接続され実際のサイズが確定してから描画する(clientWidthを正しく測るため)。
    if (history.length > 0) {
      drawPriceChart(canvas, history, 7);
    }
  }
}

init();
