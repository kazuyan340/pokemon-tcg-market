"""カード1枚ごとに固有のURL(site/card/{id}.html)を持つ静的ページを生成する
(conanと同じ設計。詳細はconan/web/generate_card_pages.pyのdocstring参照)。

本サイトの1件=card_prints 1行(印刷バリエーション)。export_static.export_cards()と
同じJOINクエリでカードテキストを展開して使う。
"""
import html
import json
from pathlib import Path

import db
from export_static import compute_current_prices, export_cards

SITE_BASE_URL = "https://kazuyan340.github.io/pokemon-tcg-market"
CARD_PAGE_DIR = Path(__file__).parent / "site" / "card"
SITE_DIR = Path(__file__).parent / "site"

ASSET_VERSION = "1"

NAV_LINKS = [
    ("index.html", "📋 一覧"),
    ("trends.html", "📊 価格の動きを見る"),
    ("movers-up.html", "🔺 値上がりを見る"),
    ("movers-down.html", "🔻 値下がりを見る"),
    ("ranking.html", "💰 相場ランキング"),
    ("compare.html", "★ お気に入り"),
    ("deck.html", "🃏 デッキ作成"),
]

STATIC_PAGES = [
    "index.html", "trends.html", "movers-up.html", "movers-down.html",
    "ranking.html", "compare.html", "deck.html",
    "about.html", "privacy.html",
]


def _e(value) -> str:
    if value is None:
        return ""
    return html.escape(str(value), quote=True)


def _json_script(data) -> str:
    return json.dumps(data, ensure_ascii=False).replace("</", "<\\/")


def _nav_links_html() -> str:
    items = [f'<a href="{href}" class="reset-btn nav-btn">{label}</a>' for href, label in NAV_LINKS]
    return "\n      ".join(items)


def _ability_text(card: dict) -> str:
    parts = []
    if card.get("ability"):
        label = card.get("ability_category") or "特性"
        parts.append(f"【{label}】{card['ability']}\n{card.get('ability_description') or ''}".strip())
    for prefix in ("first", "second", "third", "special"):
        name = card.get(f"{prefix}_move")
        if not name:
            continue
        energy = card.get(f"{prefix}_move_energy") or ""
        damage = card.get(f"{prefix}_move_damage") or ""
        desc = card.get(f"{prefix}_move_description") or ""
        header = "  ".join(x for x in (name, energy, damage) if x)
        parts.append("\n".join(x for x in (header, desc) if x))
    if card.get("special_rule"):
        parts.append(card["special_rule"])
    if card.get("description"):
        parts.append(card["description"])
    return "\n\n".join(p for p in parts if p)


def _static_price_stats_html(current: dict) -> str:
    avg = current["pooled_avg"]
    if avg is None:
        return ""
    prices = [v["price"] for v in current["by_site"].values()]
    range_html = ""
    if len(prices) > 1:
        range_html = f'<span class="price-avg-range">(最安 {min(prices)}円 〜 {max(prices)}円)</span>'
    return f'<div class="price-avg-highlight">相場 <span class="price-avg-value">{avg}円</span>{range_html}</div>'


def _static_price_table_html(current: dict) -> str:
    by_site = current["by_site"]
    if not by_site:
        return ""
    entries = sorted(by_site.items(), key=lambda kv: kv[1]["price"])
    rows = []
    for i, (site, v) in enumerate(entries):
        crown = "🏆" if i == 0 else ""
        rows.append(f"<tr><td>{_e(site)}{crown}</td><td>{v['price']}円</td></tr>")
    return (
        '<table class="price-site-table"><thead><tr><th>サイト</th><th>最安値</th></tr></thead>'
        f"<tbody>{''.join(rows)}</tbody></table>"
    )


def _meta_description(card: dict, current: dict) -> str:
    parts = [f"{card['name']}"]
    if card.get("rarity"):
        parts.append(f"({card['rarity']})")
    parts.append("の相場・価格情報。")
    if current["pooled_avg"] is not None:
        parts.append(f"現在の相場は{current['pooled_avg']}円です。")
    parts.append("駿河屋・カードラボ・竜のしっぽ・わいTV・カードラッシュの価格をまとめて比較できます。")
    return "".join(parts)


def _card_page_html(card: dict, current: dict) -> str:
    title = f"{card['name']}({card['rarity'] or '?'}) 相場・価格情報 | ポケモンカードゲーム カード図鑑"
    description = _meta_description(card, current)
    page_url = f"{SITE_BASE_URL}/card/{card['id']}.html"
    image_url = card.get("image_url") or ""

    fields = [
        ("カード番号", card.get("card_num")),
        ("種類", card.get("category")),
        ("タイプ", card.get("element")),
        ("HP", card.get("hp")),
        ("進化段階", card.get("evolution_rank")),
        ("レアリティ", card.get("rarity")),
        ("収録パック", card.get("pack")),
        ("弱点", card.get("week_point")),
        ("抵抗力", card.get("resistance")),
        ("にげる", card.get("escape_cost")),
    ]
    fields_html = "\n".join(
        f'<div class="field"><span class="label">{_e(label)}:</span><span>{_e(value)}</span></div>'
        for label, value in fields
        if value not in (None, "")
    )

    ability_html = _e(_ability_text(card)) or "(なし)"

    flavor_html = ""
    if card.get("flavor_text"):
        flavor_html = f'<div class="field" style="margin-top:6px"><span>{_e(card["flavor_text"])}</span></div>'

    price_stats_static = _static_price_stats_html(current)
    price_table_static = _static_price_table_html(current)
    price_empty_hidden = "hidden" if current["pooled_avg"] is not None else ""

    card_detail_json = _json_script({
        "id": card["id"],
        "card_num": card.get("card_num"),
        "name": card["name"],
        "rarity": card.get("rarity"),
        "cardrush_url": card.get("cardrush_url"),
    })

    ld_json = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": card["name"],
        "image": image_url,
        "description": description,
        "url": page_url,
    }
    if current["pooled_avg"] is not None:
        ld_json["offers"] = {
            "@type": "AggregateOffer",
            "priceCurrency": "JPY",
            "lowPrice": min(v["price"] for v in current["by_site"].values()),
            "highPrice": max(v["price"] for v in current["by_site"].values()),
            "offerCount": len(current["by_site"]),
        }

    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<base href="../">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="{_e(description)}">
<link rel="canonical" href="{page_url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ポケモンカードゲーム カード図鑑">
<meta property="og:locale" content="ja_JP">
<meta property="og:url" content="{page_url}">
<meta property="og:title" content="{_e(title)}">
<meta property="og:description" content="{_e(description)}">
<meta property="og:image" content="{_e(image_url)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="{_e(title)}">
<meta name="twitter:description" content="{_e(description)}">
<meta name="twitter:image" content="{_e(image_url)}">
<title>{_e(title)}</title>
<link rel="stylesheet" href="style.css?v={ASSET_VERSION}">
<script type="application/ld+json">{_json_script(ld_json)}</script>
</head>
<body>
<header class="toolbar">
  <div class="title-row">
    <div class="title-block">
      <h1>{_e(card['name'])}</h1>
      <p id="last-updated" class="last-updated"></p>
    </div>
    <div class="nav-links">
      {_nav_links_html()}
    </div>
    <button type="button" class="nav-menu-toggle" aria-label="メニュー" aria-expanded="false">☰</button>
  </div>
</header>

<main class="card-detail-page">
  <div class="modal-card card-detail-card">
    <div class="modal-body">
      <div class="modal-image">
        <img src="{_e(image_url)}" alt="{_e(card['name'])}">
      </div>
      <div class="modal-info">
        {fields_html}
        <div class="ability">{ability_html}</div>
        {flavor_html}
      </div>
    </div>

    <div class="modal-price-section">
      <h3>相場推移</h3>
      <div id="modal-price-stats" class="price-stats">{price_stats_static}</div>
      <div class="price-detail-row">
        <div id="modal-price-table" class="price-table-col">{price_table_static}</div>
        <div class="price-chart-col">
          <div class="period-tabs hidden" id="period-tabs">
            <button type="button" class="period-tab" data-days="0">全期間</button>
            <button type="button" class="period-tab active" data-days="7">7日</button>
            <button type="button" class="period-tab" data-days="30">30日</button>
          </div>
          <canvas id="price-chart" width="420" height="260" class="hidden"></canvas>
        </div>
      </div>
      <p id="price-empty" class="price-empty {price_empty_hidden}">価格データがありません。</p>
    </div>
  </div>

  <p class="card-detail-back"><a href="index.html">← カード一覧へ戻る</a></p>
</main>

<footer class="site-disclaimer">
  <p>価格情報は当サイト調べです。実際の価格・在庫状況と差異が生じる場合があります。掲載しているカード画像はcardrush.media提供の画像を参照しています。</p>
  <p><a href="about.html">運営者情報</a>　<a href="privacy.html">プライバシーポリシー・お問い合わせ</a></p>
</footer>

<script>window.CARD_DETAIL = {card_detail_json};</script>
<script src="common.js?v={ASSET_VERSION}"></script>
<script src="card-detail.js?v={ASSET_VERSION}"></script>
</body>
</html>
"""


def generate_card_pages(conn, cards: list[dict]) -> int:
    CARD_PAGE_DIR.mkdir(parents=True, exist_ok=True)
    current_prices = compute_current_prices(conn)
    for card in cards:
        current = current_prices.get(card["id"], {"pooled_avg": None, "by_site": {}})
        html_text = _card_page_html(card, current)
        (CARD_PAGE_DIR / f"{card['id']}.html").write_text(html_text, encoding="utf-8")
    return len(cards)


def generate_sitemap(cards: list[dict]) -> None:
    urls = [f"{SITE_BASE_URL}/{page}" for page in STATIC_PAGES]
    urls += [f"{SITE_BASE_URL}/card/{card['id']}.html" for card in cards]
    body = "\n".join(f"  <url><loc>{u}</loc></url>" for u in urls)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n"
        "</urlset>\n"
    )
    (SITE_DIR / "sitemap.xml").write_text(xml, encoding="utf-8")


def main():
    conn = db.get_connection()
    db.init_db(conn)
    cards = export_cards(conn)
    count = generate_card_pages(conn, cards)
    generate_sitemap(cards)
    print(f"card pages: {count}件 -> {CARD_PAGE_DIR}")
    print(f"sitemap.xml: {len(STATIC_PAGES) + len(cards)}件のURL")
    conn.close()


if __name__ == "__main__":
    main()
