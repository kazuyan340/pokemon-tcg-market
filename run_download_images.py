"""cards.image_source を site/card-images/ にダウンロードして image_url 列を更新する。
再実行しても既にファイルがあるものはスキップするので、途中で止めても再開できる。

image_url IS NULL の行だけでなく、image_url が設定済みでも実ファイルが
site/card-images/ に存在しない行も対象に含める。DBの image_url は「ダウンロード
成功した」という記録でしかないため、後から card-images/ ディレクトリを作り直す等で
ファイルだけ消えると、DB上は成功のままなのに画像が404になり続ける不整合が起きる
(2026-09-24に実際に1,007件でこれが発生し、site/ ディレクトリ再編時の
rm -rf card-images 後にこのスクリプトを再実行した際、DBの記録を信じて
再ダウンロードをスキップしてしまったことが原因と判明)。毎回ファイルの実在を
確認することでこの種の不整合を自動的に検知・修復する。
"""
import logging
from pathlib import Path

import db
import images

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent / "site" / "card-images"


def main():
    conn = db.get_connection()
    db.init_db(conn)
    rows = conn.execute(
        "SELECT id, image_source, image_url FROM cards WHERE image_source IS NOT NULL ORDER BY popularity DESC"
    ).fetchall()
    cards = []
    repaired = 0
    for r in rows:
        row = dict(r)
        if row["image_url"] and not (OUT_DIR / row["image_url"]).exists():
            row["image_url"] = None
            repaired += 1
        if row["image_url"] is None:
            cards.append(row)
    if repaired:
        logger.warning("DB上は成功済みだが実ファイルが無かった行: %d件(再ダウンロード対象に追加)", repaired)
    logger.info("ダウンロード対象: %d件", len(cards))

    batch = 200
    for i in range(0, len(cards), batch):
        chunk = cards[i:i + batch]
        images.download_card_images(chunk, OUT_DIR)
        for c in chunk:
            conn.execute("UPDATE cards SET image_url = ? WHERE id = ?", (c["image_url"], c["id"]))
        conn.commit()
        logger.info("進捗 %d/%d", min(i + batch, len(cards)), len(cards))

    conn.close()


if __name__ == "__main__":
    main()
