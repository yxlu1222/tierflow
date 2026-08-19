#!/usr/bin/env python3
"""Resumable Hugging Face snapshot downloader using only Python stdlib."""

import argparse
import concurrent.futures
import json
import os
import pathlib
import random
import shutil
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


USER_AGENT = "tierflow-appliance-downloader/1.0"
PRINT_LOCK = threading.Lock()


def log(message):
    with PRINT_LOCK:
        print(message, flush=True)


def request_json(url, timeout):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def list_files(repo, revision, timeout):
    encoded_repo = "/".join(urllib.parse.quote(part, safe="") for part in repo.split("/"))
    encoded_revision = urllib.parse.quote(revision, safe="")
    url = (
        f"https://huggingface.co/api/models/{encoded_repo}/tree/{encoded_revision}"
        "?recursive=true&expand=false"
    )
    entries = request_json(url, timeout)
    files = []
    for entry in entries:
        if entry.get("type") != "file":
            continue
        files.append({"path": entry["path"], "size": int(entry.get("size") or 0)})
    if not files:
        raise RuntimeError(f"No files returned for {repo}@{revision}")
    return files


def resolve_url(repo, revision, filename):
    encoded_repo = "/".join(urllib.parse.quote(part, safe="") for part in repo.split("/"))
    encoded_revision = urllib.parse.quote(revision, safe="")
    encoded_path = "/".join(
        urllib.parse.quote(part, safe="") for part in filename.split("/")
    )
    return (
        f"https://huggingface.co/{encoded_repo}/resolve/{encoded_revision}/{encoded_path}"
        "?download=true"
    )


def format_size(value):
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    number = float(value)
    for unit in units:
        if number < 1024 or unit == units[-1]:
            return f"{number:.2f} {unit}"
        number /= 1024


def download_one(repo, revision, root, item, timeout, retries):
    relative = pathlib.PurePosixPath(item["path"])
    destination = root.joinpath(*relative.parts)
    destination.parent.mkdir(parents=True, exist_ok=True)
    expected = item["size"]
    if destination.exists() and destination.stat().st_size == expected:
        return {"path": item["path"], "size": expected, "status": "existing"}

    partial = destination.with_name(destination.name + ".part")
    if destination.exists():
        destination.unlink()
    if partial.exists() and partial.stat().st_size > expected:
        partial.unlink()

    url = resolve_url(repo, revision, item["path"])
    for attempt in range(1, retries + 1):
        current = partial.stat().st_size if partial.exists() else 0
        if current == expected:
            os.replace(partial, destination)
            return {"path": item["path"], "size": expected, "status": "downloaded"}
        headers = {"User-Agent": USER_AGENT}
        if current:
            headers["Range"] = f"bytes={current}-"
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                status = getattr(response, "status", response.getcode())
                if current and status != 206:
                    log(f"RESET {item['path']} server_status={status}")
                    partial.unlink(missing_ok=True)
                    current = 0
                    continue
                mode = "ab" if current else "wb"
                with open(partial, mode) as output:
                    while True:
                        block = response.read(8 * 1024 * 1024)
                        if not block:
                            break
                        output.write(block)
            actual = partial.stat().st_size
            if actual != expected:
                raise IOError(
                    f"size mismatch after transfer: expected={expected}, actual={actual}"
                )
            os.replace(partial, destination)
            log(f"DONE {item['path']} {format_size(expected)}")
            return {"path": item["path"], "size": expected, "status": "downloaded"}
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as error:
            if attempt == retries:
                raise
            delay = min(30, 2 ** min(attempt, 5)) + random.random()
            log(
                f"RETRY {item['path']} attempt={attempt}/{retries} "
                f"offset={format_size(current)} error={error} wait={delay:.1f}s"
            )
            time.sleep(delay)
    raise RuntimeError(f"Unreachable retry loop for {item['path']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--revision", default="main")
    parser.add_argument("--target", required=True)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--retries", type=int, default=10)
    args = parser.parse_args()

    root = pathlib.Path(args.target).resolve()
    root.mkdir(parents=True, exist_ok=True)
    files = list_files(args.repo, args.revision, args.timeout)
    total = sum(item["size"] for item in files)
    log(
        f"SNAPSHOT repo={args.repo} revision={args.revision} files={len(files)} "
        f"total={format_size(total)} target={root}"
    )

    manifest = {
        "repo": args.repo,
        "revision": args.revision,
        "files": files,
        "total_size": total,
    }
    manifest_path = root / ".tierflow-download-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    completed = 0
    completed_bytes = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(
                download_one,
                args.repo,
                args.revision,
                root,
                item,
                args.timeout,
                args.retries,
            ): item
            for item in files
        }
        try:
            for future in concurrent.futures.as_completed(futures):
                result = future.result()
                completed += 1
                completed_bytes += result["size"]
                log(
                    f"PROGRESS files={completed}/{len(files)} "
                    f"bytes={format_size(completed_bytes)}/{format_size(total)}"
                )
        except BaseException:
            for future in futures:
                future.cancel()
            raise

    for item in files:
        path = root.joinpath(*pathlib.PurePosixPath(item["path"]).parts)
        actual = path.stat().st_size if path.exists() else -1
        if actual != item["size"]:
            raise RuntimeError(
                f"Final verification failed for {item['path']}: "
                f"expected={item['size']}, actual={actual}"
            )
    log(f"COMPLETE repo={args.repo} total={format_size(total)}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
