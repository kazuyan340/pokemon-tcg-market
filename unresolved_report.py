"""各価格スクレイパーが「出品はあり価格も付いているのに、DBのカード印刷1件に
特定できなかった商品」を data/unresolved_raw/{site}.json に書き出すための共通ヘルパー。

build_unresolved_report.py がこれら各サイトの生データをまとめて、DB照会で
候補カードの画像等を補完した上で、管理ページ(site/admin-unresolved.html)が
読み込む web/site/data/unresolved-shop-items.json を作る (conan/onepieceと同じ設計)。
"""
import json
from pathlib import Path

UNRESOLVED_DIR = Path(__file__).parent / "site" / "data" / "unresolved_raw"
MANUAL_RESOLUTIONS_PATH = Path(__file__).parent / "manual_resolutions.json"


def write_unresolved(site: str, entries: list[dict]) -> None:
    UNRESOLVED_DIR.mkdir(parents=True, exist_ok=True)
    path = UNRESOLVED_DIR / f"{site}.json"
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")


def load_manual_resolutions() -> dict[str, int]:
    if not MANUAL_RESOLUTIONS_PATH.exists():
        return {}
    data = json.loads(MANUAL_RESOLUTIONS_PATH.read_text(encoding="utf-8"))
    return {entry["product_url"]: entry["print_id"] for entry in data if entry.get("product_url")}
