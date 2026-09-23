"""各ショップの価格スクレイパー共通: card_num(+わかる場合はレアリティ)から
card_prints.id を引き当てるヘルパー。conan/onepiece と同じ resolve/apply_resolution
パターンを踏襲する。

ポケモンカードは再録が非常に多く、同じ card_num (pack_code + model_number) でも
イラストレーター違い等で card_prints に複数行が対応することがある
(extra_difference列)。ショップの商品情報だけではそこまで確実に区別できないため、
自動推測はせず、候補が複数残った場合は常に「特定できなかったもの」として扱い、
管理ページ(site/admin-unresolved.html)でユーザーに選んでもらう。

ユーザーが管理ページで選んだ結果は manual_resolutions.json (商品ページURL -> print_id)
に反映され、次回以降のスクレイパー実行ではそちらが最優先で使われる。
"""
import json
from collections import defaultdict
from pathlib import Path

MANUAL_RESOLUTIONS_PATH = Path(__file__).parent / "manual_resolutions.json"


def build_lookup(conn) -> dict[str, list[dict]]:
    rows = conn.execute(
        "SELECT p.id, p.card_num, p.rarity_name AS rarity, p.pack_name, p.image_url, "
        "c.name FROM card_prints p JOIN cards c ON c.id = p.card_id "
        "WHERE p.card_num IS NOT NULL"
    ).fetchall()
    lookup: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        lookup[row["card_num"]].append(dict(row))
    return lookup


def build_lookup_by_model_number(conn) -> dict[str, list[dict]]:
    """竜のしっぽ等、商品名にパックコードが付かず型番(model_number)だけで
    表記するショップ向けの補助インデックス。同じ型番が複数の弾にまたがって
    存在しうる(例: "124/103" は複数弾で使われる連番)ため、build_lookup()より
    衝突しやすい。resolve_by_model_number()はrarityでの絞り込みを必須とする。
    """
    rows = conn.execute(
        "SELECT p.id, p.card_num, p.model_number, p.rarity_name AS rarity, p.pack_name, "
        "p.image_url, c.name FROM card_prints p JOIN cards c ON c.id = p.card_id "
        "WHERE p.model_number IS NOT NULL"
    ).fetchall()
    lookup: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        lookup[row["model_number"]].append(dict(row))
    return lookup


def resolve_by_model_number(
    model_number: str,
    lookup: dict[str, list[dict]],
    rarity: str | None = None,
    product_url: str | None = None,
    manual_resolutions: dict[str, int] | None = None,
) -> dict:
    if manual_resolutions and product_url and product_url in manual_resolutions:
        return {"status": "resolved", "print_id": manual_resolutions[product_url]}

    candidates = lookup.get(model_number, [])
    if rarity:
        narrowed = [c for c in candidates if c["rarity"] == rarity]
        if narrowed:
            candidates = narrowed

    if not candidates:
        return {"status": "missing"}
    if len(candidates) == 1:
        return {"status": "resolved", "print_id": candidates[0]["id"]}
    return {"status": "ambiguous", "candidates": candidates}


def load_manual_resolutions() -> dict[str, int]:
    if not MANUAL_RESOLUTIONS_PATH.exists():
        return {}
    data = json.loads(MANUAL_RESOLUTIONS_PATH.read_text(encoding="utf-8"))
    return {entry["product_url"]: entry["print_id"] for entry in data if entry.get("product_url")}


def resolve(
    card_num: str,
    lookup: dict[str, list[dict]],
    rarity: str | None = None,
    product_url: str | None = None,
    manual_resolutions: dict[str, int] | None = None,
) -> dict:
    """商品(card_num, rarity, product_url)を card_prints 1行に特定する。

    戻り値:
    - {"status": "resolved", "print_id": ...}
    - {"status": "ambiguous", "candidates": [...]}
    - {"status": "missing"}
    """
    if manual_resolutions and product_url and product_url in manual_resolutions:
        return {"status": "resolved", "print_id": manual_resolutions[product_url]}

    candidates = lookup.get(card_num, [])
    if rarity:
        base_rarity = rarity.split("/")[0].strip()
        narrowed = [c for c in candidates if c["rarity"] == base_rarity]
        if narrowed:
            candidates = narrowed

    if not candidates:
        return {"status": "missing"}
    if len(candidates) == 1:
        return {"status": "resolved", "print_id": candidates[0]["id"]}
    return {"status": "ambiguous", "candidates": candidates}


def apply_resolution(
    all_prices: dict,
    unresolved_entries: list,
    card_num: str,
    rarity: str | None,
    price: int,
    lookup: dict[str, list[dict]],
    manual_resolutions: dict[str, int],
    product_name: str | None = None,
    image_url: str | None = None,
    product_url: str | None = None,
) -> None:
    result = resolve(card_num, lookup, rarity, product_url, manual_resolutions)
    if result["status"] == "resolved":
        all_prices[result["print_id"]].append(price)
        return

    entry = {
        "raw_key": card_num,
        "rarity": rarity,
        "price": price,
        "product_name": product_name,
        "image_url": image_url,
        "product_url": product_url,
        "candidates": result.get("candidates", []),
    }
    unresolved_entries.append(entry)
