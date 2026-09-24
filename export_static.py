"""SQLite (cards / card_prints / price_history) を静的サイト用のJSONに書き出すスクリプト。

conan/onepieceの1テーブル構成と違い、本サイトは「カードテキスト(cards)」と
「印刷バリエーション(card_prints)」が分かれているため、静的サイトが扱う1件=
card_prints 1行(カードテキストをJOINして展開したもの)とする。これは conan/onepiece
サイトの「1件=card_num」という粒度に相当する(ショップの価格比較はcard_num=印刷単位
でしか意味を持たないため)。

書き出すファイルは conan/onepiece と同じ構成:
  site/data/cards.json          … カード(印刷)一覧全件
  site/data/prices/{id}.json    … 1枚分の価格履歴全件(データがあるカードのみ)
  site/data/prices_latest.json  … id -> {pooled_avg, by_site} の最新相場のみ(軽量)
  site/data/trends.json         … 値動きランキング
  site/data/movers.json         … 前回比の値上がり/値下がり
  site/data/meta.json           … 生成時刻・サイトごとの最終取得日
"""
import json
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import db

TREND_LIMIT = 50
MOVERS_LIMIT = 100

OUTPUT_DIR = Path(__file__).parent / "site" / "data"

# images.py / run_download_images.py はDBの image_url 列に "card-images/" ディレクトリを
# 含まないファイル名だけ(例: "7844.webp")を保存する(ローカルファイル名の管理に徹し、
# サイト上でのURLパスの組み立ては出力側の責務として分離するため)。static サイトの
# 実ファイルは site/card-images/ 配下にあるため、JSON/HTMLへ書き出す際はここで
# 相対パスを組み立てる(このprefixを付け忘れると画像が全て404になる既知の不具合の
# 修正: 2026-09-24)。
CARD_IMAGE_DIR = "card-images/"


def _image_path(filename) -> str | None:
    if not filename:
        return None
    if filename.startswith(CARD_IMAGE_DIR):
        return filename
    return f"{CARD_IMAGE_DIR}{filename}"

# Amazonアソシエイト/楽天アフィリエイト/メルカリアンバサダーのID。
# conan/onepieceで既に承認済みの同一IDをそのまま再利用する(site/common.js側にも同じ値)。
AMAZON_ASSOCIATE_TAG = "conantcgmarke-22"
RAKUTEN_AFFILIATE_ID = "567cd45a.2625f6eb.567cd45b.7e49c506"
MERCARI_AFFILIATE_ID = "8969530097"


def export_cards(conn) -> list[dict]:
    rows = conn.execute(
        """
        SELECT
            p.id AS id, p.card_num AS card_num, p.model_number AS model_number,
            p.pack_name AS pack, p.pack_code AS pack_code, p.pack_released_at AS pack_released_at,
            p.rarity_name AS rarity, p.rarity_rank AS rarity_rank,
            COALESCE(p.image_url, c.image_url) AS image_url,
            c.id AS card_text_id, c.name AS name, c.ruby AS ruby, c.category AS category,
            c.element AS element, c.hp AS hp, c.ability AS ability,
            c.ability_category AS ability_category, c.ability_description AS ability_description,
            c.first_move AS first_move, c.first_move_energy AS first_move_energy,
            c.first_move_damage AS first_move_damage, c.first_move_description AS first_move_description,
            c.second_move AS second_move, c.second_move_energy AS second_move_energy,
            c.second_move_damage AS second_move_damage, c.second_move_description AS second_move_description,
            c.third_move AS third_move, c.third_move_energy AS third_move_energy,
            c.third_move_damage AS third_move_damage, c.third_move_description AS third_move_description,
            c.special_move AS special_move, c.special_move_energy AS special_move_energy,
            c.special_move_damage AS special_move_damage, c.special_move_description AS special_move_description,
            c.week_point AS week_point, c.resistance AS resistance, c.escape_cost AS escape_cost,
            c.special_rule AS special_rule, c.description AS description, c.flavor_text AS flavor_text,
            c.evolution_rank AS evolution_rank, c.popularity AS popularity
        FROM card_prints p JOIN cards c ON c.id = p.card_id
        WHERE p.card_num IS NOT NULL
        ORDER BY c.popularity DESC, p.card_num
        """
    ).fetchall()
    cards = [dict(r) for r in rows]
    for card in cards:
        card["image_url"] = _image_path(card["image_url"])
    return cards


def export_prices(conn) -> dict[str, list[dict]]:
    rows = conn.execute(
        "SELECT print_id, site, price, recorded_at, sample_count FROM price_history ORDER BY recorded_at"
    ).fetchall()
    prices: dict[str, list[dict]] = {}
    for row in rows:
        key = str(row["print_id"])
        prices.setdefault(key, []).append({
            "site": row["site"], "price": row["price"],
            "recorded_at": row["recorded_at"], "sample_count": row["sample_count"],
        })
    return prices


def write_prices_per_card(prices: dict[str, list[dict]], out_dir: Path) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    for print_id, points in prices.items():
        with open(out_dir / f"{print_id}.json", "w", encoding="utf-8") as f:
            json.dump(points, f, ensure_ascii=False, separators=(",", ":"))
    return len(prices)


def _site_latest_day(conn) -> dict[str, str]:
    rows = conn.execute("SELECT site, recorded_at FROM price_history").fetchall()
    latest: dict[str, str] = {}
    for row in rows:
        site = row["site"]
        day = row["recorded_at"][:10]
        if site not in latest or day > latest[site]:
            latest[site] = day
    return latest


def compute_current_prices(conn) -> dict[int, dict]:
    site_latest_day = _site_latest_day(conn)
    rows = conn.execute(
        "SELECT print_id, site, price, recorded_at FROM price_history ORDER BY print_id, recorded_at"
    ).fetchall()

    latest_by_print_site: dict[int, dict[str, dict]] = defaultdict(dict)
    for row in rows:
        site = row["site"]
        existing = latest_by_print_site[row["print_id"]].get(site)
        if not existing or row["recorded_at"] > existing["recorded_at"]:
            latest_by_print_site[row["print_id"]][site] = {"price": row["price"], "recorded_at": row["recorded_at"]}

    result: dict[int, dict] = {}
    for print_id, by_site in latest_by_print_site.items():
        kept = {
            site: v for site, v in by_site.items()
            if site_latest_day.get(site) and v["recorded_at"][:10] == site_latest_day[site]
        }
        prices = [v["price"] for v in kept.values()]
        pooled_avg = round(sum(prices) / len(prices)) if prices else None
        result[print_id] = {"pooled_avg": pooled_avg, "by_site": kept}
    return result


def _price_points_by_print_site(conn) -> dict[tuple[int, str], list[tuple[str, int]]]:
    rows = conn.execute(
        "SELECT print_id, site, price, recorded_at FROM price_history ORDER BY print_id, site, recorded_at"
    ).fetchall()

    latest_by_day: dict[tuple[int, str], dict[str, tuple[str, int]]] = defaultdict(dict)
    for row in rows:
        key = (row["print_id"], row["site"])
        day = row["recorded_at"][:10]
        latest_by_day[key][day] = (row["recorded_at"], row["price"])

    return {key: [days[day] for day in sorted(days)] for key, days in latest_by_day.items()}


POOLED_SITE_LABEL = "全体"


def _pooled_points_by_print(
    by_print_site: dict[tuple[int, str], list[tuple[str, int]]],
) -> dict[int, list[tuple[str, int]]]:
    by_print_day: dict[int, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    site_set_by_print_day: dict[int, dict[str, set]] = defaultdict(lambda: defaultdict(set))
    for (print_id, site), points in by_print_site.items():
        for recorded_at, price in points:
            day = recorded_at[:10]
            by_print_day[print_id][day].append(price)
            site_set_by_print_day[print_id][day].add(site)

    result: dict[int, list[tuple[str, int]]] = {}
    for print_id, days in by_print_day.items():
        sorted_days = sorted(days)
        latest_set = frozenset(site_set_by_print_day[print_id][sorted_days[-1]])
        cutoff = len(sorted_days) - 1
        for i in range(len(sorted_days) - 2, -1, -1):
            if frozenset(site_set_by_print_day[print_id][sorted_days[i]]) != latest_set:
                break
            cutoff = i
        stable_days = sorted_days[cutoff:]
        result[print_id] = [(day, round(sum(days[day]) / len(days[day]))) for day in stable_days]
    return result


def _all_price_series(conn) -> dict[tuple[int, str], list[tuple[str, int]]]:
    by_print_site = _price_points_by_print_site(conn)
    pooled = _pooled_points_by_print(by_print_site)
    combined = dict(by_print_site)
    for print_id, points in pooled.items():
        combined[(print_id, POOLED_SITE_LABEL)] = points
    return combined


def _previous_day_moves(
    by_print_site: dict[tuple[int, str], list[tuple[str, int]]],
) -> tuple[list[dict], list[dict]]:
    up, down = [], []
    for (print_id, site), points in by_print_site.items():
        if len(points) < 2:
            continue
        prev_date, prev_price = points[-2]
        last_date, last_price = points[-1]
        if prev_price <= 0 or prev_price == last_price:
            continue
        pct = (last_price - prev_price) / prev_price * 100
        item = {
            "card_id": print_id, "site": site, "change_pct": round(pct, 1),
            "previous_price": prev_price, "previous_date": prev_date,
            "latest_price": last_price, "latest_date": last_date,
        }
        (up if pct > 0 else down).append(item)
    return up, down


def _sort_limit_per_site(items: list[dict], limit: int, reverse: bool) -> list[dict]:
    by_site: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        by_site[item["site"]].append(item)
    result = []
    for site_items in by_site.values():
        site_items.sort(key=lambda x: x["change_pct"], reverse=reverse)
        result.extend(site_items[:limit])
    return result


def compute_trends(by_print_site: dict[tuple[int, str], list[tuple[str, int]]]) -> dict[str, list[dict]]:
    recent_up, recent_down = _previous_day_moves(by_print_site)

    trend_up, trend_down = [], []
    for (print_id, site), points in by_print_site.items():
        if len(points) < 3:
            continue
        mid_date, mid_price = points[-2]
        last_date, last_price = points[-1]
        prev_price = points[-3][1]
        if prev_price <= 0 or mid_price <= 0:
            continue
        item = {
            "card_id": print_id, "site": site,
            "change_pct": round((last_price - mid_price) / mid_price * 100, 1),
            "previous_price": mid_price, "previous_date": mid_date,
            "latest_price": last_price, "latest_date": last_date,
        }
        if mid_price > prev_price and last_price > mid_price:
            trend_up.append(item)
        elif mid_price < prev_price and last_price < mid_price:
            trend_down.append(item)

    return {
        "recent_up": _sort_limit_per_site(recent_up, TREND_LIMIT, reverse=True),
        "trend_up": _sort_limit_per_site(trend_up, TREND_LIMIT, reverse=True),
        "recent_down": _sort_limit_per_site(recent_down, TREND_LIMIT, reverse=False),
        "trend_down": _sort_limit_per_site(trend_down, TREND_LIMIT, reverse=False),
    }


def compute_movers(by_print_site: dict[tuple[int, str], list[tuple[str, int]]]) -> dict[str, list[dict]]:
    up, down = _previous_day_moves(by_print_site)
    return {
        "up": _sort_limit_per_site(up, MOVERS_LIMIT, reverse=True),
        "down": _sort_limit_per_site(down, MOVERS_LIMIT, reverse=False),
    }


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    conn = db.get_connection()
    db.init_db(conn)

    cards = export_cards(conn)
    with open(OUTPUT_DIR / "cards.json", "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, separators=(",", ":"))

    prices = export_prices(conn)
    per_card_count = write_prices_per_card(prices, OUTPUT_DIR / "prices")

    current_prices = compute_current_prices(conn)
    with open(OUTPUT_DIR / "prices_latest.json", "w", encoding="utf-8") as f:
        json.dump(current_prices, f, ensure_ascii=False, separators=(",", ":"))

    all_series = _all_price_series(conn)

    trends = compute_trends(all_series)
    with open(OUTPUT_DIR / "trends.json", "w", encoding="utf-8") as f:
        json.dump(trends, f, ensure_ascii=False, separators=(",", ":"))

    movers = compute_movers(all_series)
    with open(OUTPUT_DIR / "movers.json", "w", encoding="utf-8") as f:
        json.dump(movers, f, ensure_ascii=False, separators=(",", ":"))

    # admin-unofficial-cards.html は conan の「公式カード一覧に無いカードをショップ
    # 商品から逆輸入する」機能(scraper_executive_collection.py等)の管理ページを
    # 兼ねている。本サイトはcardrush.mediaの一覧APIが歴代の全カードを網羅しており
    # 同種の逆輸入機能を持たないため、常に空配列を出力してページのクラッシュを防ぐ
    # (unresolved-shop-items.jsonの表示機能はそのまま使う)。
    with open(OUTPUT_DIR / "unofficial-cards.json", "w", encoding="utf-8") as f:
        json.dump([], f)

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "site_latest_day": _site_latest_day(conn),
    }
    with open(OUTPUT_DIR / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

    print(f"cards.json: {len(cards)}件")
    print(f"prices/{{id}}.json: {per_card_count}カード分の価格履歴")
    print(f"prices_latest.json: {len(current_prices)}カード分の最新相場")
    print(
        f"trends.json: 直近上昇{len(trends['recent_up'])}件 / 上昇傾向{len(trends['trend_up'])}件 / "
        f"直近下降{len(trends['recent_down'])}件 / 下降傾向{len(trends['trend_down'])}件"
    )
    print(f"movers.json: 値上がり{len(movers['up'])}件/値下がり{len(movers['down'])}件")
    print(f"meta.json: generated_at={meta['generated_at']}")

    conn.close()


if __name__ == "__main__":
    main()
