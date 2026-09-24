"""kyuura_cards (旧裏カテゴリの実在庫)を site/data/kyuura.json に書き出す。

通常のcards.jsonとは完全に別系統。カード名+レベル+バリエーション+レアリティ記号を
1つのグループとしてまとめ、その中に状態ランク別の商品(価格・在庫・画像・購入リンク)を
配列で持たせる(kyuura.htmlはこのグループ単位で1タイルを表示する)。
"""
import json
from collections import defaultdict
from pathlib import Path

import db
from export_static import _image_path

OUTPUT_PATH = Path(__file__).parent / "site" / "data" / "kyuura.json"

# 状態ランクは良い順に並べたい(A- > B > C > D、無印は「ランク不問/共通」扱いで先頭)。
CONDITION_ORDER = ["", "A-", "A", "B", "C", "D"]


def _condition_sort_key(condition):
    value = condition or ""
    try:
        return CONDITION_ORDER.index(value)
    except ValueError:
        return len(CONDITION_ORDER)


def export_kyuura(conn) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM kyuura_cards ORDER BY name, level, variant, rarity_mark"
    ).fetchall()

    groups: dict[tuple, dict] = {}
    for row in rows:
        key = (row["name"], row["level"], row["variant"] or "", row["rarity_mark"] or "")
        if key not in groups:
            groups[key] = {
                "name": row["name"],
                "level": row["level"],
                "variant": row["variant"],
                "rarity_mark": row["rarity_mark"],
                "image_url": row["image_url"],
                "listings": [],
            }
        group = groups[key]
        if not group["image_url"] and row["image_url"]:
            group["image_url"] = row["image_url"]
        group["listings"].append({
            "id": row["id"],
            "condition": row["condition"],
            "price": row["price"],
            "in_stock": bool(row["in_stock"]),
            "product_url": row["product_url"],
        })

    result = []
    for group in groups.values():
        group["image_url"] = _image_path(group["image_url"])
        group["listings"].sort(key=lambda l: _condition_sort_key(l["condition"]))
        in_stock_prices = [l["price"] for l in group["listings"] if l["in_stock"] and l["price"] is not None]
        group["min_price"] = min(in_stock_prices) if in_stock_prices else None
        group["has_stock"] = bool(in_stock_prices)
        result.append(group)

    # 在庫のあるカードを先に、その中では最安値が高い順(レア物が目立つように)。
    result.sort(key=lambda g: (not g["has_stock"], -(g["min_price"] or 0)))
    return result


def main():
    conn = db.get_connection()
    db.init_db(conn)
    groups = export_kyuura(conn)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(groups, f, ensure_ascii=False, separators=(",", ":"))
    print(f"kyuura.json: {len(groups)}グループ ({sum(len(g['listings']) for g in groups)}件の商品)")
    conn.close()


if __name__ == "__main__":
    main()
