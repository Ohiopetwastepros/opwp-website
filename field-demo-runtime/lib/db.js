import { getCloudflareContext } from '@opennextjs/cloudflare';
export function getDb(){try{return getCloudflareContext().env.DB??null;}catch{return null;}}
