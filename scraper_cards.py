"""cardrush.media のポケモンカード一覧ページからカードのテキスト情報を取得するモジュール。

一覧ページ (https://cardrush.media/pokemon/cards?page=N) はNext.jsのSSRページで、
HTML中の <script id="__NEXT_DATA__"> にページ描画に使ったJSONがそのまま埋め込まれて
いる。そのためPlaywright等のブラウザ操作は不要で、requestsでHTMLを取得して正規表現で
そのJSONブロックを抜き出すだけで全件取得できる。

デフォルトのクエリは regulations.format.name=スタンダード (現行レギュレーションのみ、
約101ページ×40件) に絞られているが、regulations[format][name]= を空文字で明示的に
指定すると絞り込みが解除され、歴代の全カード (約312ページ×40件、limit=100なら約125
ページ) を取得できることを確認済み。本スクレイパーはデフォルトで全件モードを使う。

robots.txt は /pokemon/cards 配下を明示的に許可しているが、行儀の良いクローラーとして
ページ間に間隔を空ける。
"""
import re
import sys
import time
import json
import logging
from pathlib import Path

import requests

import db

LIST_URL = "https://cardrush.media/pokemon/cards"
REFERER = "https://cardrush.media/pokemon/cards"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": REFERER,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_TIMEOUT = 20
REQUEST_DELAY_SEC = 0.6
PAGE_SIZE = 100

NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S
)

logger = logging.getLogger(__name__)


class ScrapeError(RuntimeError):
    pass


def _clean_text(value):
    """cardrush.media は description 等のフィールドに実際の改行(\\n)をそのまま
    含んでおり、公式サイト側のような <br> の二重エスケープは無い(確認済み)。
    念のため <br> 系タグが紛れていればテキストの改行に正規化しておく。
    """
    if not isinstance(value, str):
        return value
    return re.sub(r"<br\s*/?>", "\n", value).strip() or None


def parse_card(raw: dict) -> dict:
    card = {
        "id": raw["id"],
        "name": raw.get("name") or "",
        "ruby": raw.get("ruby"),
        "searchable_name": raw.get("searchable_name"),
        "category": raw.get("category"),
        "image_key": raw.get("image_key"),
        "hp": raw.get("hp"),
        "element": raw.get("element"),
        "ability": raw.get("ability"),
        "ability_category": raw.get("ability_category"),
        "ability_description": _clean_text(raw.get("ability_description")),
        "week_point": raw.get("week_point"),
        "resistance": raw.get("resistance"),
        "escape_cost": raw.get("escape_cost"),
        "special_rule": _clean_text(raw.get("special_rule")),
        "description": _clean_text(raw.get("description")),
        "flavor_text": _clean_text(raw.get("flavor_text")),
        "evolution_rank": raw.get("evolution_rank"),
        "popularity": raw.get("popularity"),
        "image_source": raw.get("image_source"),
        "image_url": None,  # images.py が後でローカルパスに書き換える
        "source_updated_at": raw.get("updated_at"),
    }
    for slot in ("first_move", "second_move", "third_move", "special_move"):
        card[slot] = raw.get(slot)
        card[f"{slot}_energy"] = raw.get(f"{slot}_energy")
        card[f"{slot}_damage"] = raw.get(f"{slot}_damage")
        card[f"{slot}_damage_addition"] = raw.get(f"{slot}_damage_addition")
        card[f"{slot}_description"] = _clean_text(raw.get(f"{slot}_description"))
    return card


def fetch_page(page: int, session: requests.Session, all_regulations: bool = True) -> dict:
    params = {"page": page, "limit": PAGE_SIZE}
    if all_regulations:
        # 絞り込み解除。歴代の全カードを対象にする。
        params["regulations[format][name]"] = ""
    resp = session.get(LIST_URL, params=params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    m = NEXT_DATA_RE.search(resp.text)
    if not m:
        raise ScrapeError(f"__NEXT_DATA__ が見つかりません (page={page})")
    data = json.loads(m.group(1))
    return data["props"]["pageProps"]


def sync_all_cards(
    conn=None,
    delay: float = REQUEST_DELAY_SEC,
    all_regulations: bool = True,
    max_pages: int | None = None,
    progress_callback=None,
) -> dict:
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    session = requests.Session()
    summary = {"new": 0, "updated": 0, "total": 0, "pages": 0}
    try:
        page = 1
        last_page = 1
        while page <= last_page:
            if max_pages and page > max_pages:
                break
            pp = fetch_page(page, session, all_regulations=all_regulations)
            last_page = pp["lastPage"]
            cards = [parse_card(raw) for raw in pp["cards"]]
            result = db.upsert_cards(conn, cards)
            summary["new"] += result["new"]
            summary["updated"] += result["updated"]
            summary["total"] += result["total"]
            summary["pages"] += 1

            if progress_callback:
                progress_callback(page, last_page, summary["total"])

            page += 1
            if page <= last_page and (not max_pages or page <= max_pages):
                time.sleep(delay)
    finally:
        if owns_conn:
            conn.close()

    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    def _print_progress(page, last_page, total):
        logger.info("ページ %d/%d 取得完了 (累計 %d 件)", page, last_page, total)

    max_pages = int(sys.argv[1]) if len(sys.argv) > 1 else None
    result = sync_all_cards(max_pages=max_pages, progress_callback=_print_progress)
    out = Path(__file__).parent / "data" / "last_scrape_result.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    logger.info("完了: 新規 %d件 / 更新 %d件 / 合計 %d件 (結果は %s に保存)", result["new"], result["updated"], result["total"], out)
