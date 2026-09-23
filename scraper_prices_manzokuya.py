"""まんぞく屋(EC-CUBE製ショップ)からポケモンカードゲームの価格を取得し
price_history に保存するモジュール。

カードラボ・竜のしっぽ・わいTVと違い、まんぞく屋はOcnk系ではなくEC-CUBE 4系の
カートを使っている(HTML構造が異なる: `li.ec-shelfGrid__item`, `.ec-shelfGrid__item-text`,
`.price02-default`, `.productStock`)。

ポケモンカードカテゴリは https://shopmanzokuya.com/products/list?category_id=999
(トップページの「ポケカ ポケモンカード」リンクから確認済み、実測248件)。
`disp_number=500` を指定すると1ページで全件取得できることを確認済み
(EC-CUBEの検索フォームの `disp_number` セレクトに 100/200/500 の選択肢がある)。

商品名の形式(実データで確認済み):
  "(FUR) M6a 134/103 ミュウツーex"
  "[ 金枠 ] M6a 151/103 ダークライ＆クレセリアLEGEND(上)"
  "〈RR〉 M6a 047/103 ピカチュウex※ピカピカパレード"
  "《R》 M6 011/076 ウインディ"
  "【U】 M6 013/076 ブーバーン"
  "〔C〕 M6 001/076 ヘラクロス"
  "【記載なし】 M6a 基本水エネルギー"  (基本エネルギーは型番表記が無い)
括弧の種類はレアリティによって ()/[]/〈〉/《》/【】/〔〕 とバラバラだが、共通して
「[括弧]レアリティ[閉じ括弧] パックコード [型番] カード名」という構造を持つ。
型番(NNN/NNN)が無い商品(主に基本エネルギー)は card_num を組み立てられないため
価格照合の対象外とし、unresolved側に回す(raw_keyはパックコード+カード名)。
レアリティ表記「記載なし」は「レアリティ不明」を意味し、絞り込みには使わない。

セット販売品・BOX予約品(型番を含まない商品名)は正規表現に自然にマッチせず除外される。

商品一覧には売り切れ商品が表示されない(在庫がある商品のみ掲載されていることを
実データで確認済み。在庫欄は「在庫:◯」「在庫:1」等の数値/記号のみで、"×"等の
売り切れ表記は1件も観測されなかった)ため、掲載されている商品は全て在庫ありとして扱う。

まんぞく屋のrobots.txtには一般クローラー向けのCrawl-delay指定が無いが、
他サイトと同様に安全側でリクエスト間隔を空ける(1ページで全件取れるため
そもそも複数回アクセスする必要がない)。
"""
import logging
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db
import price_matching
from unresolved_report import write_unresolved

CATEGORY_URL = "https://shopmanzokuya.com/products/list"
CATEGORY_ID = 999
DISP_NUMBER = 500  # 実測248件なので1ページで全件取得できる

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_TIMEOUT = 15

# 例: "(FUR) M6a 134/103 ミュウツーex" / "【記載なし】 M6a 基本水エネルギー"
# 先頭の括弧の種類はレアリティによってバラバラ(()/[]/〈〉/《》/【】/〔〕)なので
# 文字クラスで一括して受ける。型番(NNN/NNN)は無い場合もあるため任意。
NAME_PATTERN = re.compile(
    r"^[\(\[\{【〈《〔]\s*([^\)\]\}】〉》〕]*?)\s*[\)\]\}】〉》〕]\s*(\S+?)(?:\s+(\d+/\d+))?\s+(.+)$"
)
NO_RARITY_LABEL = "記載なし"

logger = logging.getLogger(__name__)


def fetch_category_page() -> str:
    params = {"category_id": CATEGORY_ID, "disp_number": DISP_NUMBER}
    resp = requests.get(CATEGORY_URL, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[dict]:
    """在庫ありの商品一覧(dict)を返す。各dictは
    {card_num, rarity, price, product_name, image_url, product_url} を持つ。
    card_num は型番が無い商品(基本エネルギー等)では None になる
    (呼び出し側でunresolvedへ回す)。
    """
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for li in soup.select("li.ec-shelfGrid__item"):
        name_el = li.select_one(".ec-shelfGrid__item-text")
        if not name_el:
            continue
        name_text = name_el.get_text(strip=True)
        m = NAME_PATTERN.match(name_text)
        if not m:
            continue
        rarity_raw, pack_code, model_number, product_name = m.groups()
        rarity = None if (not rarity_raw or rarity_raw == NO_RARITY_LABEL) else rarity_raw
        card_num = f"{pack_code} {model_number}" if model_number else None

        price_el = li.select_one(".price02-default")
        price = None
        if price_el:
            price_text = price_el.get_text()
            m_price = re.search(r"[\d,]+", price_text)
            if m_price:
                try:
                    price = int(m_price.group(0).replace(",", ""))
                except ValueError:
                    price = None

        img_el = li.select_one("img")
        image_url = img_el.get("src") if img_el else None
        if image_url and image_url.startswith("/"):
            image_url = "https://shopmanzokuya.com" + image_url

        link_el = li.select_one("a")
        product_url = link_el.get("href") if link_el else None

        results.append({
            "card_num": card_num,
            "rarity": rarity,
            "price": price,
            "product_name": product_name,
            "image_url": image_url,
            "product_url": product_url,
            "raw_key": f"{pack_code} {product_name}" if not card_num else card_num,
        })
    return results


def sync_prices(conn=None, progress_callback=None) -> dict:
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    lookup = price_matching.build_lookup(conn)
    manual_resolutions = price_matching.load_manual_resolutions()
    logger.info("価格照合対象card_num: %d件", len(lookup))

    all_prices: dict[int, list[int]] = defaultdict(list)
    unresolved_entries: list[dict] = []

    try:
        html = fetch_category_page()
        items = parse_items(html)
        logger.info("まんぞく屋ポケモンカテゴリ: %d件取得", len(items))

        for item in items:
            if item["price"] is None:
                continue
            if item["card_num"] is None:
                # 型番が組み立てられない商品(基本エネルギー等)は照合できないため、
                # 誤った価格を記録するより未解決として管理ページに回す。
                unresolved_entries.append({
                    "raw_key": item["raw_key"], "rarity": item["rarity"], "price": item["price"],
                    "product_name": item["product_name"], "image_url": item["image_url"],
                    "product_url": item["product_url"], "candidates": [],
                })
                continue
            price_matching.apply_resolution(
                all_prices, unresolved_entries, item["card_num"], item["rarity"], item["price"],
                lookup, manual_resolutions, item["product_name"], item["image_url"], item["product_url"],
            )

        if progress_callback:
            progress_callback(len(items), len(all_prices))

        run_recorded_at = datetime.now(timezone.utc).isoformat()
        for print_id, prices in all_prices.items():
            db.insert_price(conn, print_id, "まんぞく屋", min(prices), recorded_at=run_recorded_at, sample_count=len(prices))

        write_unresolved("まんぞく屋", unresolved_entries)

        summary = {"matched_prints": len(all_prices), "unresolved": len(unresolved_entries)}
        logger.info(
            "完了: %d件のプリントに価格反映 (未解決 %d件)",
            summary["matched_prints"], summary["unresolved"],
        )
        return summary
    finally:
        if owns_conn:
            conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    def _print_progress(total, matched_count):
        logger.info("%d件取得完了 (累計マッチ %d件)", total, matched_count)

    sync_prices(progress_callback=_print_progress)
