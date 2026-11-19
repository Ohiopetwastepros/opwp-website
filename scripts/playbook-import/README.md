# Private dry-run history imports

These scripts only read providers and write redacted local review artifacts. They do not replay messages through automation, promote candidates, write D1/Airtable, change provider settings, create an iPhone backup, or send messages. `--apply`, `--send`, `--write`, and `--production` are rejected. Output is restricted to the approved private run import folder; never move imported data into source or fixtures.

Every source writes a unique redacted JSONL file under `import/datasets/`. `active-import-manifest.json` explicitly lists the current datasets. Mining reads only that manifest and fails closed with no datasets when it is absent; legacy root JSONL files and archived prior datasets are never scanned. Each source removes its old active entries before attempting import, including when credentials are missing. The aggregate runner starts a fresh manifest and marks iPhone skipped; run Python afterward to add an explicit iPhone dataset before mining. Prior datasets remain intact for private review, outside the current manifest.

Run from the lead-playbook worktree with Node 24 and Python 3:

```powershell
node scripts/playbook-import/run.mjs --env 'D:\Codex Projects\_agent-runs\2026-11-19-lead-playbook\import\private\provider.env' --identities 'D:\Codex Projects\_agent-runs\2026-11-19-lead-playbook\import\private\business-identities.json'
```

`provider.env` contains credentials supplied privately by the owner. Quo needs `QUO_API_KEY`; optional `QUO_API_BASE_URL` is `https://api.quo.com` or the supported legacy `https://api.openphone.com`. `QUO_HUMAN_USER_IDS` and `QUO_SONA_USER_IDS` are comma-separated IDs verified against provider metadata. Unknown outgoing authors remain `sona`; null or a generic user ID does not prove Craig authored it. Quo reads both configured source IDs in `quo.mjs`, follows all history cursors and retries rate limits.

Meta needs `META_PAGE_ACCESS_TOKEN`, `META_GRAPH_API_VERSION`, `META_ALLOWED_PAGE_IDS`, `META_LEAD_FORM_IDS`; set `META_INSTAGRAM_ACCOUNT_ID` for outbound IG attribution. IDs are comma-separated. The permission probe reads `/me/permissions`; a failed probe is recorded as unknown, never a grant. Missing permissions skip the applicable source. All messages-edge pages are fetched separately from conversation pages. Counts describe only history visible to the API. A Page sender ID does not identify its human author. Outbound turns remain quarantined as `sona` unless Craig supplies `--manual-meta-messages` pointing to a private JSON array of verified manually authored message IDs.

The optional private identity directory is JSON:

```json
{"leads":[{"phone":"+15555550101","name":"Example Lead","email":"lead@example.test","address":"123 Example Street"}],"customers":[],"contacts":[],"staff":[],"vendors":[]}
```

Populate it from actual authorized D1 submissions, Sweep&Go client and Quo contact records. Add `outcome` (`won`, `lost`, `no_reply`, `unknown`) and `outcome_source` when verified. Quo staff/vendor matches are excluded before mining. Existing customers need positive sales intent to be kept; without a directory, Quo admission uses the first inbound sales intent and the report states the match directory was unavailable. No synthetic directory is used for operational imports.

The iPhone importer reads only an existing **unencrypted copy** of `sms.db` in SQLite read-only mode. It supports NSKeyedArchive and bounded NSString typedstream `attributedBody` text. It counts and skips undecodable attributed bodies. Encrypted backups must first be decrypted locally with an owner-approved tool; this script never takes a password or decrypts a backup. `--allowlist` and `--denylist` are required. Either file can be newline-separated phones or JSON `{ "phones": ["+15555550101"], "groups": [], "names": ["Example Lead"] }`. Use private files, never committed examples containing real identities. `groups` accepts an exact chat identifier or a keyed hash; groups are dropped unless explicitly allowed. A denied participant always drops the whole chat, including an allowed group. Other chats are discarded before message text is read. `--identities` adds leads/customers/contacts to the business phone allowlist and known names to redaction.

Automatic phone matches accept only a US `+1` number or a formatted 10-digit US phone (a conventional leading US `1` is also accepted). International and email handles cannot match by their last 10 digits. Explicit alternate handles require a private `handles` array, for example `{ "phones": [], "handles": ["business-person@example.test"], "groups": [] }`. The denylist accepts the same format; exact handles are checked before any group or phone allow decision. Identity-directory names, emails, phones and full addresses all feed Python redaction. Obvious full names after meeting/contact cues and short street numbers are conservatively removed even without directory metadata.

```powershell
python scripts/playbook-import/iphone-sms.py 'D:\Codex Projects\_agent-runs\2026-11-19-lead-playbook\import\private\sms.db' --allowlist 'D:\Codex Projects\_agent-runs\2026-11-19-lead-playbook\import\private\business-allowlist.json' --denylist 'D:\Codex Projects\_agent-runs\2026-11-19-lead-playbook\import\private\family-personal-denylist.json' --identities 'D:\Codex Projects\_agent-runs\2026-11-19-lead-playbook\import\private\business-identities.json'
node scripts/playbook-import/mine.mjs
```

The miner uses the same rule classifier and policy lint as live drafts, pairs only Craig replies, clusters near-duplicates, and creates `candidates.jsonl`, `candidates.csv`, `candidates.md`. It never promotes answers. An optional model fallback requires `LEAD_CLASSIFIER_ENABLED=true`, `LEAD_CLASSIFIER_PROVIDER=workers_ai`, `LEAD_CLASSIFIER_DAILY_CAP`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN` with Workers AI access. `LEAD_CLASSIFIER_KILL_SWITCH=true` disables it. A local SQLite ledger atomically caps calls across processes and stores token counts without customer text. All imported text is redacted before a model call. The report records measured token usage; zero calls costs zero.

Keep `import/private/redaction-key` private and stable across reruns to preserve keyed identity hashes. Delete the copied `sms.db` afterward or retain the backup encrypted. Review counts, source coverage, identity admission, authorship and candidate violations before any later separately authorized D1 import.
# Private Quo configuration

Supply `QUO_BUSINESS_PHONE_NUMBER_ID` and `QUO_INDUSTRY_PHONE_NUMBER_ID` in the private provider env file. The importer never embeds operational number IDs in source. Set `LEAD_PLAYBOOK_CRAIG_CELL` so owner notifications are excluded before reading their messages. Explicit Sona metadata always overrides other author associations; unknown authors remain Sona. Private review URLs are removed from all learning prose.
