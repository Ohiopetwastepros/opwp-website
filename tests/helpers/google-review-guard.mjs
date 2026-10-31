import {runPrivateInNewContext} from './private-vm.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import { readBoundedBytes } from '../../lib/bounded-body.mjs';
// Exercise the actual shared JSON/body guard, with only external dependencies stubbed.
const source = fs.readFileSync(new URL('../../lib/public-api-security.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
export function protectJsonRequest(request, options, limited) {
  return runPrivateInNewContext(source + '\nprotectJsonRequest', { Response, TextDecoder, readBoundedBytes, checkRateLimit: async () => ({ allowed: !limited }), rateLimitResponse: () => new Response(null, { status: 429 }) })(request, options);
}
