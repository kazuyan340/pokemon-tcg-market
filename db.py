"""SQLite データベースアクセス層。

cardrush.media のカード一覧APIは「カードの文字テキスト(技・特性・HP等)」を
`id` (数値・一意) で管理しており、実際の印刷バリエーション(弾・型番・レアリティ)は
カード詳細ページの `uniques[]` に別途ぶら下がる1対多の関係になっている
(同じ「ピカチュウ」というテキスト内容のカードが複数の弾に再録される、など)。

そのため conan/onepiece の1テーブル構成 (cards.card_num が印刷単位で一意) とは異なり、
本サイトでは
  - cards       : カードテキスト単位 (cardrush の card id が主キー)
  - card_prints : 印刷バリエーション単位 (pack/model_number/rarity。card_num はこちらが持つ)
の2テーブルに分割する。ショップの価格は印刷単位でしか意味を持たないため、
price_history は card_prints.id を参照する。
"""
import sqlite3
from pathlib import Path
from datetime import datetime, timezone

DB_PATH = Path(__file__).parent / "data" / "pokemon_tcg.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    ruby TEXT,
    searchable_name TEXT,
    category TEXT,
    image_key TEXT,
    hp INTEGER,
    element TEXT,
    ability TEXT,
    ability_category TEXT,
    ability_description TEXT,
    first_move TEXT,
    first_move_energy TEXT,
    first_move_damage TEXT,
    first_move_damage_addition TEXT,
    first_move_description TEXT,
    second_move TEXT,
    second_move_energy TEXT,
    second_move_damage TEXT,
    second_move_damage_addition TEXT,
    second_move_description TEXT,
    third_move TEXT,
    third_move_energy TEXT,
    third_move_damage TEXT,
    third_move_damage_addition TEXT,
    third_move_description TEXT,
    special_move TEXT,
    special_move_energy TEXT,
    special_move_damage TEXT,
    special_move_damage_addition TEXT,
    special_move_description TEXT,
    week_point TEXT,
    resistance TEXT,
    escape_cost TEXT,
    special_rule TEXT,
    description TEXT,
    flavor_text TEXT,
    evolution_rank TEXT,
    popularity INTEGER,
    image_source TEXT,
    image_url TEXT,
    source_updated_at TEXT,
    fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS card_prints (
    id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL,
    card_num TEXT,
    model_number TEXT,
    extra_difference TEXT,
    pack_id INTEGER,
    pack_name TEXT,
    pack_code TEXT,
    pack_released_at TEXT,
    rarity_id INTEGER,
    rarity_name TEXT,
    rarity_rank INTEGER,
    original_image_source TEXT,
    image_url TEXT,
    cardrush_price INTEGER,
    cardrush_stock INTEGER,
    cardrush_url TEXT,
    fetched_at TEXT,
    FOREIGN KEY (card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    print_id INTEGER NOT NULL,
    site TEXT NOT NULL,
    price INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,
    sample_count INTEGER,
    FOREIGN KEY (print_id) REFERENCES card_prints(id)
);

CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name);
CREATE INDEX IF NOT EXISTS idx_prints_card ON card_prints(card_id);
CREATE INDEX IF NOT EXISTS idx_prints_card_num ON card_prints(card_num);
CREATE INDEX IF NOT EXISTS idx_price_print ON price_history(print_id);
"""

CARD_COLUMNS = [
    "id", "name", "ruby", "searchable_name", "category", "image_key", "hp", "element",
    "ability", "ability_category", "ability_description",
    "first_move", "first_move_energy", "first_move_damage", "first_move_damage_addition", "first_move_description",
    "second_move", "second_move_energy", "second_move_damage", "second_move_damage_addition", "second_move_description",
    "third_move", "third_move_energy", "third_move_damage", "third_move_damage_addition", "third_move_description",
    "special_move", "special_move_energy", "special_move_damage", "special_move_damage_addition", "special_move_description",
    "week_point", "resistance", "escape_cost", "special_rule", "description", "flavor_text",
    "evolution_rank", "popularity", "image_source", "image_url", "source_updated_at",
]

PRINT_COLUMNS = [
    "id", "card_id", "card_num", "model_number", "extra_difference",
    "pack_id", "pack_name", "pack_code", "pack_released_at",
    "rarity_id", "rarity_name", "rarity_rank",
    "original_image_source", "image_url",
    "cardrush_price", "cardrush_stock", "cardrush_url",
]


def get_connection(db_path: Path = DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def upsert_cards(conn: sqlite3.Connection, cards: list[dict]) -> dict:
    new_count = 0
    updated_count = 0
    now = datetime.now(timezone.utc).isoformat()

    placeholders = ", ".join(f":{c}" for c in CARD_COLUMNS)
    assignments = ", ".join(f"{c}=excluded.{c}" for c in CARD_COLUMNS if c not in ("id", "fetched_at"))

    sql = f"""
        INSERT INTO cards ({", ".join(CARD_COLUMNS)}, fetched_at)
        VALUES ({placeholders}, :fetched_at)
        ON CONFLICT(id) DO UPDATE SET {assignments}, fetched_at=excluded.fetched_at
        WHERE excluded.source_updated_at IS NOT cards.source_updated_at
    """

    for card in cards:
        existing = conn.execute("SELECT source_updated_at FROM cards WHERE id = ?", (card["id"],)).fetchone()
        row = {**card, "fetched_at": now}
        conn.execute(sql, row)
        if existing is None:
            new_count += 1
        elif existing["source_updated_at"] != card["source_updated_at"]:
            updated_count += 1

    conn.commit()
    return {"new": new_count, "updated": updated_count, "total": len(cards)}


def upsert_prints(conn: sqlite3.Connection, prints: list[dict]) -> dict:
    new_count = 0
    updated_count = 0
    now = datetime.now(timezone.utc).isoformat()

    placeholders = ", ".join(f":{c}" for c in PRINT_COLUMNS)
    assignments = ", ".join(f"{c}=excluded.{c}" for c in PRINT_COLUMNS if c != "id")

    sql = f"""
        INSERT INTO card_prints ({", ".join(PRINT_COLUMNS)}, fetched_at)
        VALUES ({placeholders}, :fetched_at)
        ON CONFLICT(id) DO UPDATE SET {assignments}, fetched_at=excluded.fetched_at
    """

    for p in prints:
        existing = conn.execute("SELECT id FROM card_prints WHERE id = ?", (p["id"],)).fetchone()
        row = {**p, "fetched_at": now}
        conn.execute(sql, row)
        if existing is None:
            new_count += 1
        else:
            updated_count += 1

    conn.commit()
    return {"new": new_count, "updated": updated_count, "total": len(prints)}


def get_distinct_values(conn: sqlite3.Connection, column: str, table: str = "cards") -> list[str]:
    rows = conn.execute(
        f"SELECT DISTINCT {column} FROM {table} WHERE {column} IS NOT NULL AND {column} != '' ORDER BY {column}"
    ).fetchall()
    return [r[0] for r in rows]


def count_cards(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0]


def count_prints(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM card_prints").fetchone()[0]


def prints_needing_detail(conn: sqlite3.Connection, limit: int | None = None) -> list[int]:
    """まだ card_prints が1件も無い (＝詳細ページ未取得の) cards.id を popularity 順で返す。"""
    sql = (
        "SELECT c.id FROM cards c LEFT JOIN card_prints p ON p.card_id = c.id "
        "WHERE p.id IS NULL ORDER BY c.popularity DESC"
    )
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [r["id"] for r in conn.execute(sql).fetchall()]


def search_prints(conn: sqlite3.Connection, rarities=None) -> list[sqlite3.Row]:
    query = (
        "SELECT p.*, c.name AS card_name FROM card_prints p JOIN cards c ON c.id = p.card_id WHERE 1=1"
    )
    params: list = []
    if rarities:
        placeholders = ", ".join("?" for _ in rarities)
        query += f" AND p.rarity_name IN ({placeholders})"
        params += list(rarities)
    return conn.execute(query, params).fetchall()


def insert_price(
    conn: sqlite3.Connection,
    print_id: int,
    site: str,
    price: int,
    recorded_at: str | None = None,
    sample_count: int | None = None,
) -> None:
    recorded_at = recorded_at or datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO price_history (print_id, site, price, recorded_at, sample_count) VALUES (?, ?, ?, ?, ?)",
        (print_id, site, price, recorded_at, sample_count),
    )
    conn.commit()


def get_price_history(conn: sqlite3.Connection, print_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM price_history WHERE print_id = ? ORDER BY recorded_at", (print_id,)
    ).fetchall()
