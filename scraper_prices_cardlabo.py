"""カードラボからポケモンカードゲームの価格を取得し price_history に保存するモジュール。

カードラボの検索結果には goods_name というクラスの要素に
"【ポケカ】{カード名}(バリエーション)【{レアリティ}】{パックコード} {型番}" という形式で
カード番号(パックコード+型番)とレアリティが残っている
(例: "【ポケカ】ボスの指令(ゲーチス)【-】SVHM 046/053")。
"【ポケカ】" がポケモンカードゲームのシングルカードだけに付く社内用キーワードらしく
(conanでの"CTCG"、ワンピースでの検索キーワードに相当)、これ1つでシングルカードだけを
横断検索できる(サプライ/BOX/オリパ等の雑貨は含まれない)。実データで確認済み。

カードラボのrobots.txtには一般クローラー向けのCrawl-delay指定が無いが、
駿河屋と同様に安全側でリクエスト間隔30秒を採用する。
"""
import logging
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db
import price_matching
from unresolved_report import write_unresolved

SEARCH_URL = "https://www.c-labo-online.jp/product-list/"
KEYWORD = "【ポケカ】"
PAGE_SIZE = 120

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 30
MAX_PAGES = 120  # 安全のための上限(実際の最終ページはparse_total_countから算出)

# 例: "【ポケカ】ボスの指令(ゲーチス)【-】SVHM 046/053"
NAME_PATTERN = re.compile(r"^【ポケカ】(.+?)【([^】]+)】\s*(\S+)\s+(\d+/\d+)\s*$")

logger = logging.getLogger(__name__)


def fetch_search_page(page: int) -> str:
    params = {"keyword": KEYWORD, "num": PAGE_SIZE, "page": page}
    resp = requests.get(SEARCH_URL, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[tuple[str, str, int | None, str | None, str | None, str | None]]:
    """(card_num, rarity, price, キャラ名(あれば), 商品画像URL(あれば),
    商品ページURL(あれば)) のリストを返す。在庫切れの場合はpriceがNoneになる。
    """
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for li in soup.select("li.list_item_cell"):
        name_el = li.select_one(".goods_name")
        if not name_el:
            continue

        name_text = name_el.get_text()
        m = NAME_PATTERN.match(name_text)
        if not m:
            continue
        product_name, rarity, pack_code, model_number = m.groups()
        card_num = f"{pack_code} {model_number}"

        photo_el = li.select_one(".global_photo")
        image_url = photo_el.get("data-src") if photo_el else None
        link_el = li.select_one("a.item_data_link")
        product_url = link_el.get("href") if link_el else None

        if "list_item_soldout" in (li.get("class") or []):
            results.append((card_num, rarity, None, product_name, image_url, product_url))
            continue

        price_el = li.select_one(".price .figure")
        if not price_el:
            continue

        price_text = price_el.get_text().split("円")[0].replace(",", "").strip()
        try:
            price = int(price_text)
        except ValueError:
            continue

        results.append((card_num, rarity, price, product_name, image_url, product_url))
    return results


def parse_total_count(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    el = soup.select_one(".count_number .number")
    if not el:
        return 0
    return int(el.get_text().replace(",", ""))


def sync_prices(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    lookup = price_matching.build_lookup(conn)
    manual_resolutions = price_matching.load_manual_resolutions()
    logger.info("価格照合対象card_num: %d件", len(lookup))

    all_prices: dict[int, list[int]] = defaultdict(list)
    unresolved_entries: list[dict] = []
    first_request = True

    try:
        page = 1
        last_page = 1
        while page <= min(last_page, MAX_PAGES):
            if not first_request:
                time.sleep(delay)
            first_request = False

            try:
                html = fetch_search_page(page)
            except requests.RequestException as exc:
                logger.warning("カードラボの取得に失敗 (page=%d): %s", page, exc)
                break

            if page == 1:
                total = parse_total_count(html)
                last_page = max(1, -(-total // PAGE_SIZE))  # 切り上げ除算

            for card_num, rarity, price, product_name, image_url, product_url in parse_items(html):
                if price is None:
                    continue
                price_matching.apply_resolution(
                    all_prices, unresolved_entries, card_num, rarity, price,
                    lookup, manual_resolutions, product_name, image_url, product_url,
                )

            if progress_callback:
                progress_callback(page, last_page, len(all_prices))

            page += 1

        run_recorded_at = datetime.now(timezone.utc).isoformat()
        for print_id, prices in all_prices.items():
            count = len(prices)
            min_price = min(prices)
            db.insert_price(conn, print_id, "カードラボ", min_price, recorded_at=run_recorded_at, sample_count=count)

        write_unresolved("カードラボ", unresolved_entries)

        summary = {
            "matched_prints": len(all_prices),
            "unresolved": len(unresolved_entries),
        }
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

    def _print_progress(page, last_page, matched_count):
        logger.info("ページ%d/%d取得完了 (累計マッチ %d件)", page, last_page, matched_count)

    sync_prices(progress_callback=_print_progress)
