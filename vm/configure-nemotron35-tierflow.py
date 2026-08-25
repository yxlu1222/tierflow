#!/usr/bin/env python3
import argparse
import json
import sqlite3
import time


PUBLIC_MODEL = "Nemotron-3.5-Lightning-30B-A3B"
UPSTREAM_MODEL = PUBLIC_MODEL
BASE_URL = "http://127.0.0.1:8104"
APPLIANCE_MEMORY_THRESHOLD = 97
LOCAL_URLS = (
    "http://127.0.0.1:8101",
    "http://127.0.0.1:8102",
    "http://127.0.0.1:8103",
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
        """
        SELECT * FROM channels
         WHERE base_url IN (?, ?, ?)
         ORDER BY CASE base_url WHEN ? THEN 0 ELSE 1 END, id
         LIMIT 1
        """,
        (LOCAL_URLS[1], LOCAL_URLS[0], LOCAL_URLS[2], LOCAL_URLS[1]),
    ).fetchone()

    group_name = (reference["group"] if reference else None) or "default"
    priority = reference["priority"] if reference else 0
    weight = reference["weight"] if reference else 100
    tag = reference["tag"] if reference else None
    status = 1 if args.activate else 2
    mapping = json.dumps(
        {PUBLIC_MODEL: UPSTREAM_MODEL}, ensure_ascii=False, separators=(",", ":")
    )
    setting = json.dumps(
        {"normalize_system_messages": True},
        ensure_ascii=False,
        separators=(",", ":"),
    )

    channel = connection.execute(
        "SELECT id FROM channels WHERE base_url = ? ORDER BY id LIMIT 1",
        (BASE_URL,),
    ).fetchone()

    with connection:
        connection.execute(
            """
            INSERT INTO options (key, value)
            VALUES ('performance_setting.monitor_memory_threshold', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (str(APPLIANCE_MEMORY_THRESHOLD),),
        )

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
            "tierflow-local-nemotron35-lightning",
            PUBLIC_MODEL,
            status,
            "Nemotron-3.5-Lightning-30B-A3B 本地推理",
            weight,
            BASE_URL,
            PUBLIC_MODEL,
            group_name,
            mapping,
            priority,
            tag,
            setting,
            "DGX Spark 本地 NVIDIA Nemotron 3.5 Lightning 30B-A3B NVFP4 + DSpark 推理服务",
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
                   SET type = 1,
                       key = ?,
                       test_model = ?,
                       status = ?,
                       name = ?,
                       weight = ?,
                       base_url = ?,
                       models = ?,
                       "group" = ?,
                       model_mapping = ?,
                       priority = ?,
                       auto_ban = 1,
                       tag = ?,
                       setting = ?,
                       remark = ?
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

    print(
        f"configured channel_id={channel_id} model={PUBLIC_MODEL} "
        f"upstream={UPSTREAM_MODEL} active={args.activate}"
    )


if __name__ == "__main__":
    main()
