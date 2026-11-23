// The caller must execute the returned SQL against its separate LOCAL database.
// This module never discovers credentials, opens a database or invokes Wrangler.
export { LOCAL_PREVIEW_ADMIN_EMAIL, localPreviewAdminSeed } from '../lib/local-preview-admin.mjs';
