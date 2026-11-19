"""Read an owner-provided COPY of sms.db. No backup, phone access, or writes to SQLite."""
import argparse
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import plistlib
import re
import sqlite3
import struct
import uuid

RUN_IMPORT = Path(r"D:\Codex Projects\_agent-runs\2026-11-19-lead-playbook\import")


def phone_key(value):
    text = str(value or "").strip()
    if not re.fullmatch(r"\+?[\d ().-]+", text):
        return ""
    digits = re.sub(r"\D", "", text)
    if len(digits) == 10 and not text.startswith("+"):
        return digits
    return digits[1:] if len(digits) == 11 and digits.startswith("1") else ""


def read_list(filename):
    if not filename:
        return {"phones": [], "handles": [], "groups": [], "names": []}
    text = Path(filename).read_text(encoding="utf-8-sig")
    if text.lstrip().startswith("{"):
        value = json.loads(text)
        return {"phones": value.get("phones", []), "handles": value.get("handles", []), "groups": value.get("groups", []), "names": value.get("names", [])}
    return {"phones": [line.strip() for line in text.splitlines() if line.strip() and not line.startswith("#")], "handles": [], "groups": [], "names": []}


def save_manifest(folder, manifest):
    filename = folder / "active-import-manifest.json"
    temporary = folder / ("active-import-manifest." + str(uuid.uuid4()) + ".tmp")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    temporary.replace(filename)


def attributed_text(blob):
    """Decode text-bearing NSKeyedArchive or NSString typedstream without executing objects."""
    if not blob:
        return ""
    value = bytes(blob)
    if len(value) > 2 * 1024 * 1024:
        return ""
    if value.startswith(b"bplist00"):
        try:
            archive = plistlib.loads(value)
            objects = archive.get("$objects", []) if isinstance(archive, dict) else []
            for item in objects:
                if isinstance(item, dict) and "NS.string" in item:
                    candidate = item["NS.string"]
                    if isinstance(candidate, plistlib.UID) and candidate.data < len(objects):
                        candidate = objects[candidate.data]
                    if isinstance(candidate, str):
                        return candidate
        except (ValueError, TypeError, OverflowError, plistlib.InvalidFileException):
            return ""
    marker = value.find(b"NSString")
    if marker < 0:
        return ""
    start = value.find(b"\x01+", marker)
    if start < 0:
        return ""
    offset = start + 2
    try:
        length = value[offset]
        offset += 1
        if length == 0x81:
            length = struct.unpack_from("<h", value, offset)[0]
            offset += 2
        elif length == 0x82:
            length = struct.unpack_from("<i", value, offset)[0]
            offset += 4
        if length < 0 or length > 20000 or offset + length > len(value):
            return ""
        return value[offset:offset + length].decode("utf-8")
    except (IndexError, struct.error, UnicodeDecodeError):
        return ""


def redact(text, names=(), emails=(), addresses=(), phones=()):
    text = str(text or "")[:20000]
    text = re.sub(r'''(?:https?://[^\s/]+)?/admin/playbook/d/[^\s<>"']+''', "[PRIVATE_REVIEW_LINK]", text, flags=re.IGNORECASE)
    names = {part for name in names if name for part in [name, *str(name).split()] if len(part) > 1}
    for values, label in ((addresses, "ADDRESS"), (emails, "EMAIL"), (phones, "PHONE")):
        for item in sorted(filter(None, values), key=len, reverse=True):
            text = re.sub(re.escape(str(item)), "[" + label + "]", text, flags=re.IGNORECASE)
    for name in sorted(filter(None, names), key=len, reverse=True):
        text = re.sub(re.escape(name), "[NAME]", text, flags=re.IGNORECASE)
    text = re.sub(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[EMAIL]", text, flags=re.IGNORECASE)
    text = re.sub(r"(?:\+?1[ .()-]*)?(?:\(?\d{3}\)?[ .()-]*)\d{3}[ .()-]*\d{4}\b", "[PHONE]", text)
    text = re.sub(r"\b\d{1,6}\s+(?:(?:[NSEW]\.?|north|south|east|west)\s+)?(?:[a-z][a-z.'-]*\s+){1,6}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|circle|cir|terrace|trail)\b\.?", "[ADDRESS]", text, flags=re.IGNORECASE)
    text = re.sub(r"\b((?:[Mm]eet|[Cc]ontact|[Aa]sk for|[Ss]peak (?:to|with)|[Tt]alk (?:to|with)|[Ff]or|[Ff]rom|[Ww]ith|[Cc]ustomer|[Cc]lient|[Ll]ead)\s+)[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){1,3}\b", r"\1[NAME]", text)
    text = re.sub(r"\b((?:[Aa]t|[Aa]ddress(?: is)?|[Ll]ocated at|[Ll]ive at|[Ss]ervice (?:at|address)|[Pp]roperty at)\s*:?\s*)\d{1,6}\s+[a-zA-Z][a-zA-Z.'-]*(?:\s+[a-zA-Z][a-zA-Z.'-]*){0,4}", r"\1[ADDRESS]", text)
    text = re.sub(r"(?<![$\w])\d{1,6}(?=\s+(?!(?:dogs?|weeks?|months?|days?|hours?|minutes?|acres?|times?|am|pm)\b)[a-z])", "[STREET_NUMBER]", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(my name is|this is)\s+[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?", r"\1 [NAME]", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(i am|i'm)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?", r"\1 [NAME]", text)
    text = re.sub(r"\b(address\s*(?:is|:)?\s*)\d{1,6}\b", r"\1[STREET_NUMBER]", text, flags=re.IGNORECASE)
    text = re.sub(r"\b\d{1,6}(?=\s+(?:[NSEW]\.?|north|south|east|west)\s+[a-z])", "[STREET_NUMBER]", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(Hi|Hello|Hey|Thanks|Thank you),?\s+[A-Z][a-z]+\b", r"\1 [NAME]", text)
    return re.sub(r"(?<![$\w])\d{3,}(?!\w)", "[NUMBER]", text)


def apple_time(value):
    seconds = float(value or 0)
    if abs(seconds) > 1e12:
        seconds /= 1e9
    try:
        return (datetime.datetime(2001, 1, 1, tzinfo=datetime.timezone.utc) + datetime.timedelta(seconds=seconds)).isoformat()
    except (ValueError, OverflowError):
        return None


def import_sms(input_path, output=RUN_IMPORT, allowlist=None, denylist=None, identities=None):
    output = Path(output).resolve()
    base = RUN_IMPORT.resolve()
    if output != base and base not in output.parents:
        raise ValueError("Output must stay inside the approved private run folder.")
    output.mkdir(parents=True, exist_ok=True)
    manifest_file = output / "active-import-manifest.json"
    manifest = json.loads(manifest_file.read_text(encoding="utf-8")) if manifest_file.exists() else {"schemaVersion": 1, "sources": {}}
    if manifest.get("schemaVersion") != 1 or not isinstance(manifest.get("sources"), dict):
        raise ValueError("Invalid active import manifest.")
    manifest["sources"].pop("iphone_backup", None)
    save_manifest(output, manifest)
    source = Path(input_path).resolve(strict=True)
    if source.is_dir():
        raise ValueError("Input must be a copied SQLite database file.")
    allow = read_list(allowlist)
    deny = read_list(denylist)
    phones = {phone_key(item) for item in allow["phones"] if len(phone_key(item)) == 10}
    denied = {phone_key(item) for item in deny["phones"] if len(phone_key(item)) == 10}
    allowed_handles = {str(item).strip().casefold() for item in allow["handles"] if str(item).strip()}
    denied_handles = {str(item).strip().casefold() for item in [*deny["handles"], *deny["phones"]] if str(item).strip()}
    names = list(allow["names"])
    emails, addresses, known_phones = [], [], []
    if identities:
        directory = json.loads(Path(identities).read_text(encoding="utf-8-sig"))
        for kind in ("leads", "customers", "contacts"):
            for item in directory.get(kind, []):
                row = {"phone": item} if isinstance(item, str) else item
                key = phone_key(row.get("phone"))
                if len(key) == 10:
                    phones.add(key)
                    names.extend(filter(None, [row.get("name"), row.get("first_name"), row.get("last_name")]))
                    emails.append(row.get("email"))
                    addresses.append(row.get("address"))
                    known_phones.append(row.get("phone"))
    if not phones and not allowed_handles and not allow["groups"]:
        raise ValueError("An explicit business allowlist is required before reading messages.")
    output.mkdir(parents=True, exist_ok=True)
    private = output / "private"
    private.mkdir(exist_ok=True)
    secret_file = private / "redaction-key"
    if not secret_file.exists():
        secret_file.write_bytes(os.urandom(32))
    secret = secret_file.read_bytes()
    digest = lambda text: hmac.new(secret, str(text).encode(), hashlib.sha256).hexdigest()
    counts = {"source": "iphone_backup", "dryRun": True, "status": "complete", "threads": 0, "kept": 0, "dropped": 0, "turns": 0, "unreadableAttributedBodies": 0, "reasons": {}, "sends": 0, "productionWrites": 0}
    db = sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)
    db.execute("PRAGMA query_only=ON")
    db.row_factory = sqlite3.Row
    relative = "datasets/iphone_backup-" + str(uuid.uuid4()) + ".jsonl"
    dataset = output / relative
    dataset.parent.mkdir(parents=True, exist_ok=True)
    try:
        columns = {row[1] for row in db.execute("PRAGMA table_info(message)")}
        attributed = 'm."attributedBody" AS attributed_body' if "attributedBody" in columns else "NULL AS attributed_body"
        with dataset.open("x", encoding="utf-8") as target:
            for chat in db.execute("SELECT ROWID AS chat_id, chat_identifier FROM chat"):
                counts["threads"] += 1
                handles = [row[0] for row in db.execute("SELECT h.id FROM chat_handle_join ch JOIN handle h ON h.ROWID=ch.handle_id WHERE ch.chat_id=?", (chat["chat_id"],))]
                keys = {phone_key(handle) for handle in handles}
                exact_handles = {str(handle).strip().casefold() for handle in handles}
                group_allowed = chat["chat_identifier"] in allow["groups"] or digest(chat["chat_identifier"]) in allow["groups"]
                reason = ""
                if keys & denied or exact_handles & denied_handles or chat["chat_identifier"] in deny["groups"] or digest(chat["chat_identifier"]) in deny["groups"]:
                    reason = "personal_denylist"
                elif len(handles) != 1 and not group_allowed:
                    reason = "group_not_allowlisted"
                elif not group_allowed and (not handles or not all(phone_key(handle) in phones and bool(phone_key(handle)) or str(handle).strip().casefold() in allowed_handles for handle in handles)):
                    reason = "not_business_allowlisted"
                if reason:
                    counts["dropped"] += 1
                    counts["reasons"][reason] = counts["reasons"].get(reason, 0) + 1
                    continue
                counts["kept"] += 1
                # Only now read text from a business-allowlisted thread.
                query = f"SELECT m.ROWID AS message_id,m.text,m.is_from_me,m.date,{attributed} FROM chat_message_join cm JOIN message m ON m.ROWID=cm.message_id WHERE cm.chat_id=? ORDER BY m.date,m.ROWID"
                for message in db.execute(query, (chat["chat_id"],)):
                    body = message["text"]
                    if body is None:
                        body = attributed_text(message["attributed_body"])
                        if not body and message["attributed_body"]:
                            counts["unreadableAttributedBodies"] += 1
                    if not body:
                        continue
                    row = {"id": digest("iphone-message:" + str(message["message_id"])), "thread_id": digest("iphone-chat:" + str(chat["chat_id"])), "external_ref_hash": digest("|".join(sorted(handles))), "source": "iphone_backup", "channel": "sms", "direction": "outbound" if message["is_from_me"] else "inbound", "author": "craig" if message["is_from_me"] else "lead", "body_redacted": redact(body, names, emails, addresses, [*known_phones, *handles]), "slots_json": {}, "created_at": apple_time(message["date"]), "outcome": "unknown"}
                    target.write(json.dumps(row, ensure_ascii=False) + "\n")
                    counts["turns"] += 1
    finally:
        db.close()
    manifest["sources"]["iphone_backup"] = {"file": relative, "importedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    save_manifest(output, manifest)
    (output / "iphone-report.json").write_text(json.dumps(counts, indent=2) + "\n", encoding="utf-8")
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Path to an owner-provided COPY of unencrypted sms.db")
    parser.add_argument("--output", default=str(RUN_IMPORT))
    parser.add_argument("--allowlist", required=True)
    parser.add_argument("--denylist", required=True)
    parser.add_argument("--identities")
    parsed = parser.parse_args()
    try:
        print(json.dumps(import_sms(parsed.input, parsed.output, parsed.allowlist, parsed.denylist, parsed.identities)))
    except Exception:
        parser.exit(1, "iPhone import failed. Check copied database schema and private allowlist. No phone or production writes were attempted.\n")
