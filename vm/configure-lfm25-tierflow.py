#!/usr/bin/env python3
import argparse
import json
import sqlite3
import time


PUBLIC_MODEL = "LFM2.5-2.6B"
UPSTREAM_MODEL = PUBLIC_MODEL
BASE_URL = "http://127.0.0.1:8105"
LOCAL_URLS = (
    "http://127.0.0.1:8101",
    "http://127.0.0.1:8102",
    "http://127.0.0.1:8103",
    "http://127.0.0.1:8104",
    BASE_URL,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="/var/lib/tierflow/tierflow.db")
    parser.add_argument("--activate", action="store_true")
    args = parser.parse_args()

    connection = sqlite3.connect(args.db)
    connection.row_factory = sqlite3.Row
    reference = connection.execute(
        "SELECT * FROM channels WHERE base_url IN (?, ?, ?, ?) ORDER BY id LIMIT 1",
        LOCAL_URLS[:4],
    ).fetchone()
    group_name = (reference["group"] if reference else None) or "default"
    priority = reference["priority"] if reference else 0
    weight = reference["weight"] if reference else 100
    tag = reference["tag"] if reference else None
    status = 1 if args.activate else 2
    mapping = json.dumps({PUBLIC_MODEL: UPSTREAM_MODEL}, separators=(",", ":"))
    setting = json.dumps(
        {"normalize_system_messages": True}, separators=(",", ":")
    )
    channel = connection.execute(
        "SELECT id FROM channels WHERE base_url = ? ORDER BY id LIMIT 1",
        (BASE_URL,),
    ).fetchone()

    with connection:
        if args.activate:
            placeholders = ",".join("?" for _ in LOCAL_URLS)
            connection.execute(
                f"UPDATE channels SET status = 2 WHERE base_url IN ({placeholders})",
                LOCAL_URLS,
            )
            connection.execute(
                f"""
                UPDATE abilities SET enabled = 0
                 WHERE channel_id IN (
                       SELECT id FROM channels WHERE base_url IN ({placeholders})
                 )
                """,
                LOCAL_URLS,
            )

        values = (
            "tierflow-local-lfm25",
            PUBLIC_MODEL,
            status,
            "LFM2.5-2.6B 本地推理",
            weight,
            BASE_URL,
            PUBLIC_MODEL,
            group_name,
            mapping,
            priority,
            tag,
            setting,
            "DGX Spark 本地 LiquidAI LFM2.5-2.6B Q4_K_M llama.cpp 推理服务",
        )
        if channel is None:
            cursor = connection.execute(
                """
                INSERT INTO channels
                    (type, key, test_model, status, name, weight, created_time,
                     base_url, models, "group", model_mapping, priority, auto_ban,
                     tag, setting, remark)
                VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                values[:5] + (int(time.time()),) + values[5:],
            )
            channel_id = cursor.lastrowid
        else:
            channel_id = channel["id"]
            connection.execute(
                """
                UPDATE channels
                   SET type = 1, key = ?, test_model = ?, status = ?, name = ?,
                       weight = ?, base_url = ?, models = ?, "group" = ?,
                       model_mapping = ?, priority = ?, auto_ban = 1, tag = ?,
                       setting = ?, remark = ?
                 WHERE id = ?
                """,
                values + (channel_id,),
            )

        connection.execute("DELETE FROM abilities WHERE channel_id = ?", (channel_id,))
        connection.execute(
            """
            INSERT INTO abilities
                ("group", model, channel_id, enabled, priority, weight, tag)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                group_name,
                PUBLIC_MODEL,
                channel_id,
                1 if args.activate else 0,
                priority,
                weight,
                tag,
            ),
        )

    print(f"configured channel_id={channel_id} model={PUBLIC_MODEL} active={args.activate}")


if __name__ == "__main__":
    main()
