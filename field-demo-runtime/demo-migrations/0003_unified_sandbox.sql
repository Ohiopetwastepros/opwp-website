-- Only the isolated training database receives this schema.
CREATE TABLE field_sandbox_sessions (
 id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, state_json TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX field_sandbox_expiry ON field_sandbox_sessions(expires_at);
CREATE TABLE field_sandbox_events (
 session_id TEXT NOT NULL REFERENCES field_sandbox_sessions(id) ON DELETE CASCADE,
 id TEXT NOT NULL, expected_version INTEGER NOT NULL, body_hash TEXT NOT NULL,
 event_json TEXT NOT NULL, result_json TEXT NOT NULL, received_at INTEGER NOT NULL,
 PRIMARY KEY(session_id,id), UNIQUE(session_id,expected_version)
);
CREATE TRIGGER field_sandbox_event_version BEFORE INSERT ON field_sandbox_events BEGIN
 SELECT RAISE(ABORT,'SANDBOX_EVENT_LIMIT') WHERE
 (SELECT COUNT(*) FROM field_sandbox_events WHERE session_id=NEW.session_id)>=1500;
 SELECT RAISE(ABORT,'SANDBOX_VERSION_CONFLICT') WHERE NOT EXISTS
 (SELECT 1 FROM field_sandbox_sessions WHERE id=NEW.session_id AND version=NEW.expected_version);
END;
CREATE TRIGGER field_sandbox_event_commit AFTER INSERT ON field_sandbox_events BEGIN
 UPDATE field_sandbox_sessions SET version=version+1,state_json=NEW.result_json WHERE id=NEW.session_id;
END;
CREATE TABLE field_sandbox_photos (
 session_id TEXT NOT NULL REFERENCES field_sandbox_sessions(id) ON DELETE CASCADE,
 id TEXT NOT NULL, task_id TEXT NOT NULL, purpose TEXT NOT NULL, captured_at TEXT NOT NULL,
 content_hash TEXT NOT NULL, body BLOB NOT NULL CHECK(length(body)<=409600),
 PRIMARY KEY(session_id,id)
);
CREATE TRIGGER field_sandbox_photo_cap BEFORE INSERT ON field_sandbox_photos BEGIN
 SELECT RAISE(ABORT,'SANDBOX_PHOTO_LIMIT') WHERE
 (SELECT COUNT(*) FROM field_sandbox_photos WHERE session_id=NEW.session_id)>=24;
END;
