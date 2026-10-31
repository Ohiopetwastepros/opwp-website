// An account-level cap cannot be reset by rotating IPs or browser user agents.
export async function fieldQuota(db,memberId,scope,limit,seconds=60) {
  const now=Math.floor(Date.now()/1000),window=Math.floor(now/seconds)*seconds;
  const row=await db.prepare(`INSERT INTO api_rate_limits(scope,client_key,window_start,request_count,expires_at)
    VALUES (?,?,?,1,datetime(?,'unixepoch')) ON CONFLICT(scope,client_key,window_start)
    DO UPDATE SET request_count=request_count+1 RETURNING request_count`).bind(scope,memberId,window,window+2*seconds).first();
  return Boolean(row && row.request_count<=limit);
}
