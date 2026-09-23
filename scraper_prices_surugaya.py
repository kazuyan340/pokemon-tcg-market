"""駿河屋からポケモンカードゲームの価格を取得し price_history に保存するモジュール。

検索結果ページの各商品は `div.item` 1個にまとまっており、その中に商品名
(`.product-name`、例: "108/081[SR]：(キラ)カスミの元気")と価格欄(`.item_price`)が
両方入っている。型番にパックコードが含まれないため、竜のしっぽと同様
price_matching.resolve_by_model_number() で型番+レアリティから絞り込む。

検索は「レアリティ単位」で行う(例: "ポケモンカードゲーム SR")。レアリティ数(約15種)
分の検索で済むため、カード単位で1万回以上検索するより遥かに少ないリクエスト数で済む。

検索結果には無関係な他ジャンル商品(たまたま「ポケモンカードゲーム」を含む文言)が
紛れることがあるため、カテゴリ欄(`.item_detail .condition.background-kishu`)の
先頭が"ポケモンカードゲーム"であることを確認して除外する(実データで確認済み)。

駿河屋のrobots.txtは `Crawl-delay: 30` を指定しているため、リクエスト間隔は30秒を
厳守する。また駿河屋はGitHub Actionsのクラウド常設IPを403で弾くことが確認されており
(conan/onepieceで既知)、本スクレイパーはセルフホストランナー(自宅PC等の固定/動的
IPだが常設クラウドではない環境)からの実行を前提とする。
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

SEARCH_URL = "https://www.suruga-ya.jp/search"
TOP_URL = "https://www.suruga-ya.jp/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
}

EXCLUDED_RARITIES: list[str] = []

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 30  # 駿河屋のCrawl-delay:30を厳守
MAX_PAGES_PER_RARITY = 60

NAME_PATTERN = re.compile(r"^([^\[]+)\[([^\]]+)\](?:[:：](.*))?$")
CATEGORY_PREFIX = "ポケモンカードゲーム"

logger = logging.getLogger(__name__)


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(HEADERS)
    resp = session.get(TOP_URL, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return session


def fetch_search_page(session: requests.Session, rarity: str, page: int) -> str:
    query = f"ポケモンカードゲーム {rarity}"
    params = {"category": "", "search_word": query, "page": page}
    resp = session.get(SEARCH_URL, params=params, timeout=REQUEST_TIMEOUT, headers={"Referer": TOP_URL})
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[tuple[str, str, int | None, str | None, str | None, str | None]]:
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for item in soup.select("div.item"):
        name_el = item.select_one(".product-name")
        if not name_el:
            continue
        m = NAME_PATTERN.match(name_el.get_text(strip=True))
        if not m:
            continue

        category_el = item.select_one(".item_detail .condition.background-kishu")
        category_text = category_el.get_text(strip=True) if category_el else ""
        if not category_text.startswith(CATEGORY_PREFIX):
            continue

        model_number, rarity = m.group(1), m.group(2)
        product_name = m.group(3).strip() if m.group(3) else None

        link_el = item.select_one("a")
        product_url = "https://www.suruga-ya.jp" + link_el["href"] if link_el and link_el.get("href", "").startswith("/") else (link_el.get("href") if link_el else None)
        img_el = item.select_one("img")
        image_url = img_el.get("src") if img_el else None

        # 在庫ありは .price_teika 内の <strong>￥X,XXX </strong> に実売価格が入る。
        # 品切れの場合はこの要素自体が無く、"品切れ"テキストのみの.priceが出る。
        price_el = item.select_one(".item_price .price_teika strong")
        if not price_el:
            results.append((model_number, rarity, None, product_name, image_url, product_url))
            continue

        digits = re.sub(r"[^\d]", "", price_el.get_text())
        if not digits:
            continue
        results.append((model_number, rarity, int(digits), product_name, image_url, product_url))
    return results


def sync_prices(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    all_rarities = db.get_distinct_values(conn, "rarity_name", table="card_prints")
    target_rarities = [r for r in all_rarities if r not in EXCLUDED_RARITIES and r != "-"]

    lookup = price_matching.build_lookup_by_model_number(conn)
    manual_resolutions = price_matching.load_manual_resolutions()
    logger.info("対象レアリティ: %s", ", ".join(target_rarities))

    all_prices: dict[int, list[int]] = defaultdict(list)
    unresolved_entries: list[dict] = []

    try:
        session = make_session()
        first_request = True
        for rarity in target_rarities:
            page = 1
            last_page = MAX_PAGES_PER_RARITY
            while page <= last_page:
                if not first_request:
                    time.sleep(delay)
                first_request = False

                try:
                    html = fetch_search_page(session, rarity, page)
                except requests.RequestException as exc:
                    logger.warning("駿河屋の取得に失敗 (rarity=%s page=%d): %s", rarity, page, exc)
                    break

                items = parse_items(html)
                if not items and page > 1:
                    break

                for model_number, item_rarity, price, product_name, image_url, product_url in items:
                    if price is None:
                        continue
                    result = price_matching.resolve_by_model_number(
                        model_number, lookup, item_rarity, product_url, manual_resolutions
                    )
                    if result["status"] == "resolved":
                        all_prices[result["print_id"]].append(price)
                    else:
                        unresolved_entries.append({
                            "raw_key": model_number, "rarity": item_rarity, "price": price,
                            "product_name": product_name, "image_url": image_url,
                            "product_url": product_url, "candidates": result.get("candidates", []),
                        })

                if progress_callback:
                    progress_callback(rarity, page, len(all_prices))

                if len(items) < 50:  # 駿河屋は1ページ最大50件程度
                    break
                page += 1

        run_recorded_at = datetime.now(timezone.utc).isoformat()
        for print_id, prices in all_prices.items():
            db.insert_price(conn, print_id, "駿河屋", min(prices), recorded_at=run_recorded_at, sample_count=len(prices))

        write_unresolved("駿河屋", unresolved_entries)

        summary = {"matched_prints": len(all_prices), "unresolved": len(unresolved_entries)}
        logger.info("完了: %d件のプリントに価格反映 (未解決 %d件)", summary["matched_prints"], summary["unresolved"])
        return summary
    finally:
        if owns_conn:
            conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    def _print_progress(rarity, page, matched_count):
        logger.info("%s ページ%d取得完了 (累計マッチ %d件)", rarity, page, matched_count)

    sync_prices(progress_callback=_print_progress)
