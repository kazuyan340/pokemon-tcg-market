"""cardrush.media のカード詳細ページから印刷バリエーション(弾・型番・レアリティ)と
カードラッシュ(カードラッシュポケモン)の価格・在庫を取得するモジュール。

詳細ページ https://cardrush.media/pokemon/cards/{id} も一覧ページと同様に
__NEXT_DATA__ にJSONが埋め込まれており、pageProps.card.uniques[] が
印刷バリエーションの配列になっている。各要素の ocha_relations[].ocha_product に
カードラッシュの価格/在庫/商品URLが入っている(コンディション違いで複数ある場合は
在庫があるものの中から最安値を選ぶ)。

1カードあたり詳細ページ1回のアクセスで済む(何弾に何回再録されていても uniques 配列に
まとまっている)ため、全 ~12,000枚超のカードに対して総アクセス数は約12,000回。
これは長時間かかるため、本スクレイパーは db.prints_needing_detail() で「まだ
card_prints が1件も無いカード」を popularity 順に取り、limit件だけ処理して終了する
再開可能(resumable)な設計にしてある。cron/Actions やローカルで複数回に分けて
呼び出すことで、時間をかけて全件を埋められる。
"""
import re
import sys
import time
import json
import logging
from pathlib import Path

import requests

import db

DETAIL_URL_TMPL = "https://cardrush.media/pokemon/cards/{id}"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": "https://cardrush.media/pokemon/cards",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_TIMEOUT = 20
REQUEST_DELAY_SEC = 0.5

NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S
)

logger = logging.getLogger(__name__)


def fetch_detail(card_id: int, session: requests.Session) -> dict:
    url = DETAIL_URL_TMPL.format(id=card_id)
    resp = session.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    m = NEXT_DATA_RE.search(resp.text)
    if not m:
        raise RuntimeError(f"__NEXT_DATA__ not found for card {card_id}")
    data = json.loads(m.group(1))
    return data["props"]["pageProps"]


def _best_ocha(ocha_relations: list[dict]):
    """在庫ありの中から最安、無ければ在庫切れの中から最安を返す。無ければ None。"""
    candidates = [r["ocha_product"] for r in (ocha_relations or []) if r.get("ocha_product")]
    if not candidates:
        return None
    in_stock = [c for c in candidates if (c.get("stock_count") or 0) > 0]
    pool = in_stock if in_stock else candidates
    return min(pool, key=lambda c: c.get("price") or 10**9)


def parse_uniques(card_id: int, uniques: list[dict]) -> list[dict]:
    prints = []
    for u in uniques:
        pack = u.get("pack") or {}
        rarity = u.get("rarity") or {}
        model_number = u.get("model_number") or ""
        pack_code = pack.get("code") or ""
        card_num = f"{pack_code} {model_number}".strip() if model_number else None

        best = _best_ocha(u.get("ocha_relations"))

        prints.append({
            "id": u["id"],
            "card_id": card_id,
            "card_num": card_num,
            "model_number": model_number or None,
            "extra_difference": u.get("extra_difference"),
            "pack_id": pack.get("id"),
            "pack_name": pack.get("name"),
            "pack_code": pack_code or None,
            "pack_released_at": pack.get("released_at"),
            "rarity_id": rarity.get("id"),
            "rarity_name": rarity.get("name"),
            "rarity_rank": rarity.get("rank"),
            "original_image_source": u.get("original_image_source"),
            "image_url": None,
            "cardrush_price": best.get("price") if best else None,
            "cardrush_stock": best.get("stock_count") if best else None,
            "cardrush_url": best.get("ec_page_url") if best else None,
        })
    return prints


def sync_details(
    conn=None,
    limit: int = 300,
    delay: float = REQUEST_DELAY_SEC,
    progress_callback=None,
) -> dict:
    owns_conn = conn is None
    if owns_conn:
        conn = db.get_connection()
        db.init_db(conn)

    session = requests.Session()
    target_ids = db.prints_needing_detail(conn, limit=limit)
    summary = {"processed": 0, "prints_new": 0, "prints_updated": 0, "errors": 0}

    try:
        for i, card_id in enumerate(target_ids):
            try:
                pp = fetch_detail(card_id, session)
                uniques = (pp.get("card") or {}).get("uniques") or pp.get("uniques") or []
                prints = parse_uniques(card_id, uniques)
                if prints:
                    result = db.upsert_prints(conn, prints)
                    summary["prints_new"] += result["new"]
                    summary["prints_updated"] += result["updated"]
                summary["processed"] += 1
            except requests.RequestException as exc:
                logger.warning("詳細ページ取得失敗 card_id=%s: %s", card_id, exc)
                summary["errors"] += 1
            except Exception as exc:
                logger.warning("パース失敗 card_id=%s: %s", card_id, exc)
                summary["errors"] += 1

            if progress_callback:
                progress_callback(i + 1, len(target_ids), summary)
            if i + 1 < len(target_ids):
                time.sleep(delay)
    finally:
        if owns_conn:
            conn.close()

    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    def _print_progress(i, total, summary):
        if i % 25 == 0 or i == total:
            logger.info("詳細取得 %d/%d (新規プリント %d件)", i, total, summary["prints_new"])

    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    result = sync_details(limit=limit, progress_callback=_print_progress)
    out = Path(__file__).parent / "data" / "last_detail_result.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    logger.info(
        "完了: 処理%d件 / 新規プリント%d件 / 更新%d件 / エラー%d件",
        result["processed"], result["prints_new"], result["prints_updated"], result["errors"],
    )
