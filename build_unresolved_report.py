"""各価格スクレイパーが書き出した site/data/unresolved_raw/{site}.json をまとめて、
管理ページ(site/admin-unresolved.html)が読み込む site/data/unresolved-shop-items.json
を作る。price_matching.apply_resolution()の時点で候補(candidates)を既に埋め込んで
あるため、conan/onepieceのbuild_unresolved_report.pyと違い、DBへの再照会は不要で
生データをそのまま ambiguous/missing に振り分けるだけで済む。
"""
import json
from pathlib import Path

from unresolved_report import UNRESOLVED_DIR

OUT_PATH = Path(__file__).parent / "site" / "data" / "unresolved-shop-items.json"


def dedupe_missing(rows: list[dict]) -> list[dict]:
    grouped: dict[tuple, dict] = {}
    for r in rows:
        key = (r["site"], r["raw_key"], r.get("rarity"))
        if key not in grouped:
            grouped[key] = {**r, "listing_count": 1, "prices": [r["price"]] if r.get("price") is not None else []}
        else:
            grouped[key]["listing_count"] += 1
            if r.get("price") is not None:
                grouped[key]["prices"].append(r["price"])
    return list(grouped.values())


def group_ambiguous(rows: list[dict]) -> list[dict]:
    grouped: dict[tuple, dict] = {}
    for r in rows:
        key = (r["site"], r["raw_key"], r.get("rarity"))
        listing = {
            "product_url": r.get("product_url"),
            "image_url": r.get("image_url"),
            "price": r.get("price"),
            "product_name": r.get("product_name"),
        }
        if key not in grouped:
            grouped[key] = {
                "site": r["site"], "raw_key": r["raw_key"], "rarity": r.get("rarity"),
                "candidates": r.get("candidates", []), "listings": [listing],
            }
        else:
            grouped[key]["listings"].append(listing)
    return list(grouped.values())


def build_report() -> dict:
    ambiguous: list[dict] = []
    missing: list[dict] = []

    if not UNRESOLVED_DIR.exists():
        return {"ambiguous": [], "missing": []}

    for path in sorted(UNRESOLVED_DIR.glob("*.json")):
        site = path.stem
        entries = json.loads(path.read_text(encoding="utf-8"))
        for e in entries:
            row = {**e, "site": site}
            if e.get("candidates"):
                ambiguous.append(row)
            else:
                missing.append(row)

    return {"ambiguous": group_ambiguous(ambiguous), "missing": dedupe_missing(missing)}


def main():
    report = build_report()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"unresolved-shop-items.json: ambiguous={len(report['ambiguous'])}件 missing={len(report['missing'])}件")


if __name__ == "__main__":
    main()
