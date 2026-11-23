// Shared by request-time and transactional outbox writers. Creating this statement
// never contacts the email provider; the existing delivery worker owns sending.
export function submissionNotificationStatement(db, { submissionId, type, recipient, content, id = crypto.randomUUID() }) {
  return db.prepare(`INSERT INTO submission_notifications
    (id,submission_id,notification_type,recipient,subject,text_body,html_body,status)
    SELECT ?,?,?,?,?,?,?,'queued' FROM submissions s WHERE s.id=? AND s.status NOT IN ('deleted','trashed')
    ON CONFLICT(submission_id,notification_type,recipient) DO NOTHING`)
    .bind(id, submissionId, type, recipient, content.subject, content.text, content.html, submissionId);
}
