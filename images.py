"""カード画像をローカルに保存する。cardrush.media 自体がCORP(same-site)ヘッダーで
ホットリンクを弾くため、静的サイトから直接 files.cardrush.media を参照すると画像が
表示できない(One Pieceサイトで確認済みの既知の問題)。そのため必ず一度ダウンロードして
自前ホスティングする。
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Referer": "https://cardrush.media/pokemon/cards",
}
REQUEST_TIMEOUT = 15
REQUEST_DELAY_SEC = 0.3


def _extension(url: str) -> str:
    suffix = Path(url).suffix.split("?")[0]
    return suffix if suffix else ".webp"


def download_card_images(cards: list[dict], out_dir: Path, delay: float = REQUEST_DELAY_SEC) -> None:
    """cards (cards テーブルの行のdict) の image_source をダウンロードし、
    image_url フィールドをローカルパス(out_dir 基準のファイル名のみ)に書き換える。
    既にファイルが存在する場合はスキップする(再実行で差分のみ取得)。
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    for card in cards:
        url = card.get("image_source")
        if not url:
            card["image_url"] = None
            continue
        filename = f"{card['id']}{_extension(url)}"
        dest = out_dir / filename
        if not dest.exists():
            try:
                resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
                resp.raise_for_status()
                dest.write_bytes(resp.content)
                time.sleep(delay)
            except requests.RequestException as exc:
                logger.warning("画像取得に失敗: %s (%s)", url, exc)
                card["image_url"] = None
                continue
        card["image_url"] = filename


def download_print_images(prints: list[dict], out_dir: Path, delay: float = REQUEST_DELAY_SEC) -> None:
    """card_prints の original_image_source (弾ごとの実際の印刷画像) をダウンロードする。
    通常カードの代表画像は cards.image_source (download_card_images) で足りるため、
    こちらは「高レアリティ印刷の実物画像を見せたい」場合にオプトインで使う想定。
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    for p in prints:
        url = p.get("original_image_source")
        if not url:
            p["image_url"] = None
            continue
        filename = f"print_{p['id']}{_extension(url)}"
        dest = out_dir / filename
        if not dest.exists():
            try:
                resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
                resp.raise_for_status()
                dest.write_bytes(resp.content)
                time.sleep(delay)
            except requests.RequestException as exc:
                logger.warning("画像取得に失敗: %s (%s)", url, exc)
                p["image_url"] = None
                continue
        p["image_url"] = filename
