"""カードラッシュポケモン(実店舗 cardrush-pokemon.jp)の「旧裏」(1996-99年頃の
初期シリーズ)専用在庫カテゴリを取得するモジュール。

通常のカード図鑑データ(cardrush.media)には旧裏カードの情報が一切無い
(公式のムーブ/特性テキストデータも存在しない)。しかし実店舗側には
「【旧裏】」という実在庫カテゴリ(product-group/532、モバイル版で確認済み・
1,119件)が存在し、状態ランク別(状態A-/B/C/D等)に複数出品されている。
このスクレイパーはこのカテゴリだけを対象にした完全に別系統のデータ取得で、
通常のcards/card_prints/price_historyとは連携しない(kyuura_cards単独)。

商品名の形式(実データで確認済み):
  "〔状態B〕ナツメのゲンガー LV.42【-】{旧裏}"
  "〔状態A-〕ピカチュウ LV.12(マークあり)【●】{旧裏}"
  "モルフォン LV.28【★】{旧裏}"  (状態ランク表記が無い商品も存在する)
- 〔状態X〕: 状態ランク(無い場合もある)
- {name} LV.{level}: カード名+レベル
- (variant): マークあり/なし・GB・イントロパック等の注記(無い場合もある)
- 【mark】: レアリティに相当する記号(-, ●, ★ 等)
- {旧裏}: 固定タグ(このカテゴリの全商品に付く)

在庫判定は他のOcnk系ショップと同じく <li class="list_item_soldout"> の有無で行う
(価格自体は品切れでも直近価格が表示され続けるため、価格の有無では判定できない
ことを実データで確認済み)。

num=120指定でページサイズを増やせることを確認済み(既定60件→120件、
約10ページで全件を巡回できる)。robots.txt に明示的なCrawl-delay指定は無いが、
安全側で他のショップスクレイパーと同程度の間隔を空ける。
"""
import logging
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db

CATEGORY_URL = "https://www.cardrush-pokemon.jp/phone/product-group/532"
PAGE_SIZE = 120

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 5
MAX_PAGES = 30  # 安全のための上限(実際は1,119件/120件=10ページ程度)

NAME_PATTERN = re.compile(
    r"^(?:〔状態([^〕]+)〕)?(.+?)\s+LV\.(\d+)(?:\(([^)]+)\))?【([^】]*)】\{旧裏\}\s*$"
)

logger = logging.getLogger(__name__)


def fetch_page(page: int) -> str:
    params = {"num": PAGE_SIZE, "page": page}
    resp = requests.get(CATEGORY_URL, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


def parse_items(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for li in soup.select("li.list_item_cell"):
        name_el = li.select_one(".goods_name")
        if not name_el:
            continue
        m = NAME_PATTERN.match(name_el.get_text())
        if not m:
            logger.debug("名前パターン不一致、スキップ: %s", name_el.get_text())
            continue
        condition, name, level, variant, rarity_mark = m.groups()

        # id は <li class="list_item_XXXXX"> のクラス名末尾から取り出す
        # (商品詳細ページへのリンク末尾からも取れるが、こちらの方が確実)。
        item_id = None
        for cls in li.get("class") or []:
            if cls.startswith("list_item_") and cls != "list_item_cell" and cls != "list_item_soldout":
                suffix = cls[len("list_item_"):]
                if suffix.isdigit():
                    item_id = int(suffix)
                    break
        if item_id is None:
            continue

        in_stock = "list_item_soldout" not in (li.get("class") or [])

        photo_el = li.select_one(".global_photo")
        image_url = photo_el.get("data-src") if photo_el else None
        link_el = li.select_one("a.item_data_link")
        product_url = link_el.get("href") if link_el else None
        if product_url and product_url.startswith("/"):
            product_url = "https://www.cardrush-pokemon.jp" + product_url

        price = None
        price_el = li.select_one(".price .figure")
        if price_el:
            price_text = price_el.get_text().split("円")[0].replace(",", "").strip()
            try:
                price = int(price_text)
            except ValueError:
                price = None

        results.append({
            "id": item_id,
            "name": name.strip(),
            "level": level,
            "variant": variant,
            "rarity_mark": rarity_mark or None,
            "condition": condition,
            "price": price,
            "in_stock": 1 if in_stock else 0,
            "image_source": image_url,
            "image_url": None,
            "product_url": product_url,
        })
    return results


def parse_total_count(html: str) -> int:
    soup = BeautifulSoup(html, "html.parser")
    el = soup.select_one(".count_number .number")
    if not el:
        return 0
    return int(el.get_text().replace(",", ""))


def sync_kyuura(conn=None, delay: float = REQUEST_DELAY_SEC, progress_callback=None) -> dict:
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    summary = {"new": 0, "updated": 0, "total": 0, "pages": 0}
    try:
        page = 1
        last_page = 1
        first_request = True
        while page <= min(last_page, MAX_PAGES):
            if not first_request:
                time.sleep(delay)
            first_request = False

            try:
                html = fetch_page(page)
            except requests.RequestException as exc:
                logger.warning("旧裏カテゴリの取得に失敗 (page=%d): %s", page, exc)
                break

            if page == 1:
                total = parse_total_count(html)
                last_page = max(1, -(-total // PAGE_SIZE))
                logger.info("旧裏カテゴリ総件数: %d件 (%dページ)", total, last_page)

            items = parse_items(html)
            result = db.upsert_kyuura_cards(conn, items)
            summary["new"] += result["new"]
            summary["updated"] += result["updated"]
            summary["total"] += result["total"]
            summary["pages"] += 1

            if progress_callback:
                progress_callback(page, last_page, summary["total"])

            page += 1

        return summary
    finally:
        if owns_conn:
            conn.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    def _print_progress(page, last_page, total):
        logger.info("ページ %d/%d 取得完了 (累計 %d 件)", page, last_page, total)

    result = sync_kyuura(progress_callback=_print_progress)
    logger.info("完了: 新規 %d件 / 更新 %d件 / 合計 %d件", result["new"], result["updated"], result["total"])
