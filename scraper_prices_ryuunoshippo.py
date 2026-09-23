"""トレカショップ竜のしっぽからポケモンカードゲームの価格を取得し price_history に
保存するモジュール。カードラボ・わいTVと同じ系列のECカート(Ocnk系)を使っており、
HTML構造もほぼ同一。

「全商品 (ポケモンカードゲーム)」カテゴリ (product-list/8) が単品カード中心の
カテゴリだが、オリパ・デッキ商品(型番の無い商品名)も混在する(正規表現に
マッチせず自然に除外される)。単品カードの商品名は
  "{カード名}({レアリティ})({型番})"
という形式で、cardrush.media側と違いパックコードを含まない型番だけの表記
(例: "ミュウex(SAR)(124/103)")。同じ型番が複数の弾にまたがって存在しうるため、
price_matching.resolve_by_model_number() で「型番+レアリティ」の組み合わせから
絞り込む(それでも複数候補が残る場合はambiguousとして管理ページに回す)。

カテゴリ件数が16,777件と非常に多く(オリパ・デッキ等含む)、全ページの巡回には
Crawl-delay30秒基準で長時間かかる。MAX_PAGESで安全側に上限を設けている。

竜のしっぽのrobots.txtには一般クローラー向けのCrawl-delay指定が無いが、
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

CATEGORY_URL = "https://www.ryuunoshippo.com/product-list/8"
PAGE_SIZE = 120

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 30
MAX_PAGES = 150  # 安全のための上限(実際の最終ページはparse_total_countから算出)

# 例: "ミュウex(SAR)(124/103)"
NAME_PATTERN = re.compile(r"^(.+?)\(([^()]+)\)\((\d+/\d+)\)\s*$")

logger = logging.getLogger(__name__)


def fetch_page(page: int) -> str:
    params = {"num": PAGE_SIZE, "page": page}
    resp = requests.get(CATEGORY_URL, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[tuple[str, str, int | None, str | None, str | None, str | None]]:
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
        product_name, rarity, model_number = m.groups()

        photo_el = li.select_one(".global_photo")
        image_url = photo_el.get("data-src") if photo_el else None
        link_el = li.select_one("a.item_data_link")
        product_url = link_el.get("href") if link_el else None

        if "list_item_soldout" in (li.get("class") or []):
            results.append((model_number, rarity, None, product_name, image_url, product_url))
            continue

        price_el = li.select_one(".price .figure")
        if not price_el:
            continue
        price_text = price_el.get_text().split("円")[0].replace(",", "").strip()
        try:
            price = int(price_text)
        except ValueError:
            continue

        results.append((model_number, rarity, price, product_name, image_url, product_url))
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

    lookup = price_matching.build_lookup_by_model_number(conn)
    manual_resolutions = price_matching.load_manual_resolutions()

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
                html = fetch_page(page)
            except requests.RequestException as exc:
                logger.warning("竜のしっぽの取得に失敗 (page=%d): %s", page, exc)
                break

            if page == 1:
                total = parse_total_count(html)
                last_page = max(1, -(-total // PAGE_SIZE))

            for model_number, rarity, price, product_name, image_url, product_url in parse_items(html):
                if price is None:
                    continue
                result = price_matching.resolve_by_model_number(
                    model_number, lookup, rarity, product_url, manual_resolutions
                )
                if result["status"] == "resolved":
                    all_prices[result["print_id"]].append(price)
                else:
                    unresolved_entries.append({
                        "raw_key": model_number, "rarity": rarity, "price": price,
                        "product_name": product_name, "image_url": image_url,
                        "product_url": product_url, "candidates": result.get("candidates", []),
                    })

            if progress_callback:
                progress_callback(page, last_page, len(all_prices))

            page += 1

        run_recorded_at = datetime.now(timezone.utc).isoformat()
        for print_id, prices in all_prices.items():
            db.insert_price(conn, print_id, "竜のしっぽ", min(prices), recorded_at=run_recorded_at, sample_count=len(prices))

        write_unresolved("竜のしっぽ", unresolved_entries)

        summary = {"matched_prints": len(all_prices), "unresolved": len(unresolved_entries)}
        logger.info("完了: %d件のプリントに価格反映 (未解決 %d件)", summary["matched_prints"], summary["unresolved"])
        return summary
    finally:
        if owns_conn:
            conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    def _print_progress(page, last_page, matched_count):
        logger.info("ページ%d/%d取得完了 (累計マッチ %d件)", page, last_page, matched_count)

    sync_prices(progress_callback=_print_progress)
