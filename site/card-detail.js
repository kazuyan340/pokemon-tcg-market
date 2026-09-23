// カード個別ページ(card/{id}.html)用。ページ本体の主要な情報(名前・ステータス・
// 相場の数値)はビルド時(generate_card_pages.py)に静的HTMLへ直接埋め込み済みで、
//検索エンジンやJavaScript無効の環境でもそのまま読める。このスクリプトは読み込み後、
// 一覧ページのモーダルと同じ期間切り替えタブ付きのインタラクティブなグラフに
// 差し替える(値そのものは静的埋め込み分と一致する)。
//
// このページで必要なカード情報(id/card_num/name/rarity/card_id)はwindow.CARD_DETAIL
// として既にHTMLに埋め込まれているため、全カード分のcards.json(数MB)は読み込まない。
// 価格履歴もこのカード1枚分(data/prices/{id}.json)だけを取得する。

async function init() {
  bindNavMenuToggle();

  const card = window.CARD_DETAIL;
  const history = await fetchPriceHistory(card.id);
  renderPriceSection(card.id, card.card_num, card.name, card.rarity, card.cardrush_url, history);
  renderLastUpdated();
}

init();
