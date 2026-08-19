#!/usr/bin/env python3
import argparse
import json
import sqlite3
import time


PUBLIC_MODEL = "Ling-3.0-tiny"
UPSTREAM_MODEL = PUBLIC_MODEL
BASE_URL = "http://127.0.0.1:8106"
LOCAL_URLS = tuple(f"http://127.0.0.1:{port}" for port in range(8101, 8107))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="/var/lib/tierflow/tierflow.db")
    parser.add_argument("--activate", action="store_true")
    args = parser.parse_args()

    connection = sqlite3.connect(args.db)
    connection.row_factory = sqlite3.Row
    placeholders = ",".join("?" for _ in LOCAL_URLS)
    reference = connection.execute(
        f"SELECT * FROM channels WHERE base_url IN ({placeholders}) ORDER BY id LIMIT 1",
        LOCAL_URLS,
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
            "tierflow-local-ling30-tiny",
            PUBLIC_MODEL,
            status,
            "Ling-3.0-tiny 本地推理",
            weight,
            BASE_URL,
            PUBLIC_MODEL,
            group_name,
            mapping,
            priority,
            tag,
            setting,
            "DGX Spark 本地 InclusionAI Ling-3.0-tiny FP8 + SGLang 推理服务",
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
