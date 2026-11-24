import { INTENTS, PLAYBOOK_CLASSIFIER_VERSION, classifyPlaybookRules } from "./lead-playbook.mjs";
import {CLASSIFIER_PROVIDER_SCHEMA,STRUCTURED_CLASSIFIER_VERSION,classifierMessages,prefilterPlaybookOptOut,structuredClassifierFallback,validateStructuredClassifierResult} from './lead-playbook-classifier-schema.mjs';
export {detectStructuredOptOut,isPlaybookOptOut,structuredOptOut} from './lead-playbook-classifier-schema.mjs';

export const CLASSIFIER_MODEL = "@cf/openai/gpt-oss-120b";
const SLOT_KEYS = ["dogs", "frequency", "yardTier", "yardAcres", "lastCleaned", "address", "day", "name", "email", "gateSide", "trashLocation"];
const fallback = structuredClassifierFallback;
const enabled = (value) => value === true || value === "true";
export function buildClassifierProviderRequest(model,messages){
  if(model==='@cf/openai/gpt-oss-120b')return {input:messages,reasoning:{effort:'medium'},max_output_tokens:1500,text:{format:{type:'json_schema',name:'lead_classifier',schema:CLASSIFIER_PROVIDER_SCHEMA,strict:false}}};
  return {messages,max_tokens:700,temperature:0,response_format:{type:'json_schema',json_schema:CLASSIFIER_PROVIDER_SCHEMA}};
}
export function classifierResponseJson(response){
  // Retain final classification text only, never provider reasoning payloads.
  return response?.response??response?.output_text??response?.choices?.[0]?.message?.content??response?.output?.filter(item=>item.type==='message').flatMap(item=>(item.content||[]).filter(block=>block.type==='output_text').map(block=>block.text)).join('')??response;
}
export function validateClassifierResult(value) {
  if (value?.intents) return validateStructuredClassifierResult(value);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["intent", "confidence", "slots"].includes(key))) return null;
  if (!INTENTS.includes(value.intent) || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 || !value.slots || typeof value.slots !== "object" || Array.isArray(value.slots)) return null;
  if (Object.keys(value.slots).some((key) => !SLOT_KEYS.includes(key))) return null;
  for (const [key, entry] of Object.entries(value.slots)) {
    if (entry === null) continue;
    if (key === "dogs") { if (!Number.isInteger(entry) || entry < 1 || entry > 99) return null; }
    else if (key === "yardAcres") { if (!Number.isFinite(entry) || entry <= 0 || entry > 1000) return null; }
    else if (typeof entry !== "string" || entry.length > 200 || /[\r\n]/.test(entry)) return null;
    if (key === "gateSide" && !["left", "right", "no_gate"].includes(entry)) return null;
  }
  const slots = Object.fromEntries(Object.entries(value.slots).filter(([, entry]) => entry !== null));
  return { intent: value.intent, confidence: value.confidence, slots, reason: "bounded_model_classifier", classifierVersion: PLAYBOOK_CLASSIFIER_VERSION };
}

// A durable claim is required before a paid or free model call. No free-form reply
// generation exists here. Imports may provide a local durable usageStore instead.
export async function classifyPlaybookIntent(text, context = {}, { env = {}, db, provider, usageStore, now = new Date() } = {}) {
  const optOut = prefilterPlaybookOptOut(text);
  if (optOut) return {...fallback('opt_out_prefilter'),intent:optOut,intents:[optOut],confidence:1,fallbackReply:false};
  // Offline legacy policy callers remain available. The production V2 path is
  // LLM-first for every non-opt-out message; no intent regex bypass is used.
  if (!enabled(env.LEAD_CONVERSATION_V2_ENABLED)) {
    const rules = classifyPlaybookRules(text, context);
    if (rules.reason === 'confirmation_requires_review' || rules.intent !== 'other' && rules.confidence >= 0.8) return rules;
  }
  if (!enabled(env.LEAD_CLASSIFIER_ENABLED) || enabled(env.LEAD_CLASSIFIER_KILL_SWITCH)) return fallback("classifier_disabled");
  const name = String(env.LEAD_CLASSIFIER_PROVIDER || "workers_ai");
  const cap = Math.max(0, Math.min(10000, Number.parseInt(env.LEAD_CLASSIFIER_DAILY_CAP || "100", 10) || 0));
  const model = String(env.LEAD_CLASSIFIER_MODEL || CLASSIFIER_MODEL);
  if (!cap || name === "off" || name !== "workers_ai" && !provider) return fallback("classifier_provider_unavailable");
  if (!provider && typeof env.AI?.run !== "function") return fallback("classifier_binding_unavailable");
  if (!db && !usageStore) return fallback("classifier_usage_store_required");
  const usageDate = new Date(now).toISOString().slice(0, 10), id = crypto.randomUUID();
  const input = String(text || "").slice(0, 4000), messages=classifierMessages(input,context);
  const estimatedInputTokens = Math.ceil((JSON.stringify(messages).length+JSON.stringify(CLASSIFIER_PROVIDER_SCHEMA).length)/4);
  let claimed;
  try {if (usageStore) claimed = await usageStore.claim({ usageDate, provider: name, cap, id, estimatedInputTokens });
  else {
    await db.prepare("INSERT OR IGNORE INTO lead_classifier_daily_usage(usage_date,provider,calls,estimated_tokens) VALUES(?,?,0,0)").bind(usageDate, name).run();
    const claim = await db.prepare("UPDATE lead_classifier_daily_usage SET calls=calls+1,estimated_tokens=estimated_tokens+? WHERE usage_date=? AND provider=? AND calls<?").bind(estimatedInputTokens, usageDate, name, cap).run();
    claimed = claim.meta?.changes === 1;
    if (claimed) await db.prepare("INSERT INTO lead_classifier_calls(id,usage_date,provider,model,estimated_input_tokens,status,classifier_version) VALUES(?,?,?,?,?,'claimed',?)").bind(id, usageDate, name, model, estimatedInputTokens, enabled(env.LEAD_CONVERSATION_V2_ENABLED)?STRUCTURED_CLASSIFIER_VERSION:PLAYBOOK_CLASSIFIER_VERSION).run();
  }} catch {return fallback('classifier_usage_unavailable');}
  if (!claimed) return fallback("classifier_daily_cap");
  let status = "failed", estimatedOutputTokens = 0, actualTokens = null, timer, failureReason = null;
  try {
    const request = buildClassifierProviderRequest(model,messages);
    const timeoutMs = Math.max(50,Math.min(15000,Number(env.LEAD_CLASSIFIER_TIMEOUT_MS)||8000));
    const pending = provider ? provider({ model, ...request }) : env.AI.run(model, request);
    const response = await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('classifier_timeout'),{code:'classifier_timeout'})),timeoutMs);})]);
    const raw = classifierResponseJson(response);
    estimatedOutputTokens = Math.ceil((typeof raw === "string" ? raw : JSON.stringify(raw)).length / 4);
    actualTokens = Number.isInteger(response?.usage?.total_tokens) ? response.usage.total_tokens : null;
    let parsed;
    try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { parsed = null; }
    const valid = enabled(env.LEAD_CONVERSATION_V2_ENABLED) ? validateStructuredClassifierResult(parsed) : validateClassifierResult(parsed);
    status = valid ? "completed" : "invalid";
    return valid ? { ...valid, provider: name, callId:id, estimatedTokens: estimatedInputTokens + estimatedOutputTokens, actualTokens } : fallback("classifier_invalid_json",{callId:id});
  } catch (error) {status='failed';failureReason=error?.code==='classifier_timeout'?'classifier_timeout':'classifier_failed';console.warn(JSON.stringify({event:'lead_classifier_safe_fallback',callId:id,reason:failureReason}));return fallback(failureReason,{callId:id});}
  finally {
    clearTimeout(timer);
    try {if (usageStore) await usageStore.finish?.({ id, status, estimatedInputTokens, estimatedOutputTokens, actualTokens, failureReason });
    else await db.prepare("UPDATE lead_classifier_calls SET status=?,estimated_output_tokens=?,actual_tokens=? WHERE id=?").bind(status, estimatedOutputTokens, actualTokens, id).run();}
    catch {console.error(JSON.stringify({event:'lead_classifier_audit_deferred',callId:id,status}));}
  }
}
