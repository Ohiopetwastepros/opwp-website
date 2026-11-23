import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoPaymentSecrets, crmBillingEnabled, billingStaffAlert, verifyBillingUatRelayRequest } from '../lib/crm-billing-security.mjs';

test('billing storage rejects normalized sensitive keys including gateway funding aliases',()=>{
 for(const key of ['PAN','card-number','card_no','creditCardNumber','debitCardNumber','CVV2','cvc_2','security.code','bankAccount','bank_account_number','bankAccountNo','account','account_number','bankRoutingNumber','routing_no','bank-aba','abaNumber','dda_number','IBAN','achAccount','raw_response','api-key','access.token','authorization'])assert.throws(()=>assertNoPaymentSecrets({metadata:[{[key]:'sensitive'}]}),/hosted payment fields/);
});
test('ephemeral token exception applies only to the exact root token key',()=>{
 assert.equal(assertNoPaymentSecrets({token:'9412345678904242'},{allowToken:true}).token,'9412345678904242');
 for(const input of [{nested:{token:'9412345678904242'}},{token:{nested:{token:'9412345678904242'}}},{Token:'9412345678904242'},{to_ken:'9412345678904242'},[{token:'9412345678904242'}]])assert.throws(()=>assertNoPaymentSecrets(input,{allowToken:true}),/hosted payment fields/);
 assert.throws(()=>assertNoPaymentSecrets({token:'9412345678904242'}),/hosted payment fields/);
});
test('safe processor identifiers remain usable and freeform notes cannot hide account data',()=>{
 assert.doesNotThrow(()=>assertNoPaymentSecrets({profileId:'18854390708079407191',profileAccountId:'1',processorCustomerId:'18854390708079407191',orderId:'opwp123',last4:'4242',billingZip:'43601',expMonth:12,expYear:2030}));
 for(const reason of ['4111 1111 1111 1111','routing number: 123456789','bank account # 1234567','CVV2: 123','bankaba:123456789'])assert.throws(()=>assertNoPaymentSecrets({reason}),/raw payment details/);
});
test('generated UUID identifiers survive numeric runs without granting notes a payment-data exception',()=>{
 const id='aaaaaaaa-aaaa-4aaa-1234-123456789012';
 assert.doesNotThrow(()=>assertNoPaymentSecrets({invoiceIds:[id],subscriptionIds:[id],paymentMethodIds:[id],rateSnapshots:[{versionId:id}],attempts:[{idempotencyKey:`${id}:1`}],idempotencyKey:`${id}:2026-12-01:monthly`,audit:[{newValue:{key:`${id}:2026-12-01:new_client`}}]}));
 for(const kind of ['refund','void'])assert.doesNotThrow(()=>assertNoPaymentSecrets({adjustmentId:`${id}:${kind}:${id}`,idempotencyKey:`${id}:${kind}:${id}`}));
 for(const value of [`${id}:refund:4111111111111111`,`${id}:charge:${id}`])assert.throws(()=>assertNoPaymentSecrets({adjustmentId:value}),/raw payment details/);
 for(const field of ['reason','notes','label'])assert.throws(()=>assertNoPaymentSecrets({[field]:id}),/raw payment details/);
 for(const value of ['4111111111111111',`${id}:4111111111111111`,`${id}:2026-12-01:4111111111111111`])assert.throws(()=>assertNoPaymentSecrets({idempotencyKey:value}),/raw payment details/);
});
test('realistic long QBO and processor IDs survive only at typed identifier keys and QBO reference paths',()=>{
 const long='12345678901234567890',payment='9876543210987654';
 const payload={CustomerRef:{value:long},DepositToAccountRef:{value:long},PaymentRefNum:payment,Line:[{SalesItemLineDetail:{ItemRef:{value:long},TaxCodeRef:{value:long}},AccountBasedExpenseLineDetail:{AccountRef:{value:long}},LinkedTxn:[{TxnId:long,TxnType:'Invoice'}]},{JournalEntryLineDetail:{Entity:{EntityRef:{value:long}},AccountRef:{value:long}}}],TxnTaxDetail:{TaxLine:[{TaxLineDetail:{TaxRateRef:{value:long}}}]}};
 assert.doesNotThrow(()=>assertNoPaymentSecrets({realmId:long,qboId:long,qboPaymentId:payment,qboInvoiceId:long,profileId:long,profileAccountId:'1',processorCustomerId:long,sourceId:long,settings:{qboMapping:{realmId:long,bankAccountId:long,feeExpenseAccountId:long,undepositedFundsAccountId:long,itemIds:{base_plan:long},customerMappings:{customer:{customerId:long}}}},job:{mapping:{paymentId:payment,refundItemId:long},payload}}));
 for(const field of ['notes','PrivateNote','Description','reason'])assert.throws(()=>assertNoPaymentSecrets({payload:{[field]:'4111111111111111'}}),/raw payment details/);
 for(const invalid of [{value:payment},{CustomerRef:{value:payment}},{payload:{value:payment}},{payload:{OtherRef:{value:payment}}},{mapping:{value:payment}},{mapping:{itemIds:{base_plan:{notes:payment}}}},{payload:{CustomerRef:{value:payment,cvv:'123'}}},{mapping:{bankAccountNumber:payment}},{payload:{AccountRef:{value:long},routing_number:'123456789'}}])assert.throws(()=>assertNoPaymentSecrets(invalid),/raw payment details|hosted payment fields/);
 assert.throws(()=>assertNoPaymentSecrets({realmId:'x'.repeat(101)+'-'+payment}),/raw payment details/);
});
test('billing gate cannot enable production and staff alerts contain no customer STOP footer',()=>{
 const env={APP_ENV:'uat',CRM_PAYMENTS_ENV:'uat',ROUTE_OS_BILLING_ENABLED:'true'};
 assert.equal(crmBillingEnabled(env),true);assert.equal(crmBillingEnabled({...env,APP_ENV:'production'}),false);assert.equal(crmBillingEnabled({...env,CRM_PAYMENTS_ENV:'production'}),false);assert.equal(crmBillingEnabled({}),false);
 assert.doesNotMatch(billingStaffAlert({id:'fixture',status:'failed'}),/STOP/);
});
test('custom UAT relay authentication accepts only the configured Bearer secret',async()=>{
 const secret='fixture-relay-secret-32-characters-minimum',env={CRM_BILLING_UAT_RELAY_SECRET:secret};
 const request=(authorization,url='https://example.test/api/crm/billing/uat-relay/')=>new Request(url,{headers:authorization?{authorization}:{}});
 assert.equal(await verifyBillingUatRelayRequest(request(`Bearer ${secret}`),env),true);
 for(const value of ['',`Basic ${secret}`,'Bearer wrong',`Bearer ${secret} extra`])assert.equal(await verifyBillingUatRelayRequest(request(value),env),false);
 assert.equal(await verifyBillingUatRelayRequest(request('',`https://example.test/api/crm/billing/uat-relay/?secret=${secret}`),env),false);
 assert.equal(await verifyBillingUatRelayRequest(request(`Bearer ${secret}`),{}),false);
 assert.equal(await verifyBillingUatRelayRequest(request('Bearer weak'),{CRM_BILLING_UAT_RELAY_SECRET:'weak'}),false);
});
