"""cards.image_source を site/card-images/ にダウンロードして image_url 列を更新する。
再実行しても既にファイルがあるものはスキップするので、途中で止めても再開できる。
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
        "SELECT id, image_source, image_url FROM cards WHERE image_url IS NULL ORDER BY popularity DESC"
    ).fetchall()
    cards = [dict(r) for r in rows]
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
