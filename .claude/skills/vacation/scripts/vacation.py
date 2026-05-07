#!/usr/bin/env python3
"""Vacation management script — add, remove, list entries in vacations.md."""

import argparse
import os
import re
import sys
from datetime import date, datetime

# Resolve data dir relative to project root (4 levels up from this script)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", "..", ".."))
DATA_DIR = os.path.join(PROJECT_ROOT, "data", "context", "channels")

HEADER = "# Vacations\n\n| Name | User ID | Start | End | Note |\n|------|---------|-------|-----|------|\n"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def vacations_path(channel_id: str) -> str:
    return os.path.join(DATA_DIR, channel_id, "vacations.md")


def parse_table(content: str) -> list[dict]:
    entries = []
    for line in content.split("\n"):
        line = line.strip()
        if not line.startswith("|") or "---" in line:
            continue
        cells = [c.strip() for c in line.split("|")][1:-1]
        if len(cells) < 4:
            continue
        name, uid, start, end = cells[0], cells[1], cells[2], cells[3]
        note = cells[4] if len(cells) > 4 else ""
        if name == "Name" or start == "Start":
            continue
        if not DATE_RE.match(start) or not DATE_RE.match(end):
            continue
        entries.append({"name": name, "userId": uid, "start": start, "end": end, "note": note})
    return entries


def write_table(path: str, entries: list[dict]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = HEADER
    for e in entries:
        lines += f"| {e['name']} | {e['userId']} | {e['start']} | {e['end']} | {e['note']} |\n"
    with open(path, "w") as f:
        f.write(lines)


def validate_date(d: str) -> bool:
    if not DATE_RE.match(d):
        return False
    try:
        datetime.strptime(d, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def cmd_add(args):
    if not validate_date(args.start) or not validate_date(args.end):
        print(f"Error: invalid date format. Use YYYY-MM-DD.", file=sys.stderr)
        sys.exit(1)
    if args.start > args.end:
        print(f"Error: start date ({args.start}) is after end date ({args.end}).", file=sys.stderr)
        sys.exit(1)

    path = vacations_path(args.channel)
    entries = []
    if os.path.exists(path):
        with open(path) as f:
            entries = parse_table(f.read())

    # Check for duplicate
    for e in entries:
        if e["name"].lower() == args.name.lower() and e["start"] == args.start and e["end"] == args.end:
            print(f"Already exists: {args.name} {args.start} to {args.end}")
            return

    entries.append({
        "name": args.name,
        "userId": args.user_id or "",
        "start": args.start,
        "end": args.end,
        "note": args.note or "",
    })
    write_table(path, entries)
    print(f"Added: {args.name} off {args.start} to {args.end}")


def cmd_remove(args):
    path = vacations_path(args.channel)
    if not os.path.exists(path):
        print("No vacations file found.", file=sys.stderr)
        sys.exit(1)

    with open(path) as f:
        entries = parse_table(f.read())

    original_len = len(entries)
    entries = [
        e for e in entries
        if not (
            (e["name"].lower() == (args.name or "").lower() or
             (args.user_id and e["userId"] == args.user_id))
            and e["start"] == args.start
        )
    ]

    if len(entries) == original_len:
        print(f"No matching vacation found for {args.name or args.user_id} starting {args.start}")
        sys.exit(1)

    write_table(path, entries)
    print(f"Removed vacation for {args.name or args.user_id} starting {args.start}")


def cmd_list(args):
    path = vacations_path(args.channel)
    if not os.path.exists(path):
        print("No vacations recorded.")
        return

    with open(path) as f:
        entries = parse_table(f.read())

    if not entries:
        print("No vacations recorded.")
        return

    today = date.today().isoformat()
    active = [e for e in entries if e["end"] >= today]

    if not active:
        print("No upcoming vacations.")
        return

    for e in sorted(active, key=lambda x: x["start"]):
        note = f" ({e['note']})" if e["note"] else ""
        print(f"- {e['name']}: {e['start']} to {e['end']}{note}")


def main():
    parser = argparse.ArgumentParser(description="Manage vacation entries")
    sub = parser.add_subparsers(dest="command", required=True)

    # add
    p_add = sub.add_parser("add", help="Add a vacation entry")
    p_add.add_argument("--channel", required=True, help="Channel ID")
    p_add.add_argument("--name", required=True, help="Person's name")
    p_add.add_argument("--user-id", default="", help="Slack user ID")
    p_add.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")
    p_add.add_argument("--end", required=True, help="End date (YYYY-MM-DD)")
    p_add.add_argument("--note", default="", help="Optional note")

    # remove
    p_rm = sub.add_parser("remove", help="Remove a vacation entry")
    p_rm.add_argument("--channel", required=True, help="Channel ID")
    p_rm.add_argument("--name", default="", help="Person's name")
    p_rm.add_argument("--user-id", default="", help="Slack user ID")
    p_rm.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")

    # list
    p_ls = sub.add_parser("list", help="List vacations")
    p_ls.add_argument("--channel", required=True, help="Channel ID")

    args = parser.parse_args()
    if args.command == "add":
        cmd_add(args)
    elif args.command == "remove":
        cmd_remove(args)
    elif args.command == "list":
        cmd_list(args)


if __name__ == "__main__":
    main()
