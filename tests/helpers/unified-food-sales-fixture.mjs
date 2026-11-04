import fs from 'node:fs';
import vm from 'node:vm';
import {fixture} from './dog-food-fixture.mjs';
import * as logic from '../../lib/dog-food-operations.mjs';
import * as ledger from '../../lib/food-sales-ledger.mjs';
import * as auth from '../../lib/food-sales-auth.mjs';
import * as sng from '../../lib/food-sales-sng.mjs';
import * as account from '../../lib/dog-food-account.mjs';
import * as cadence from '../../lib/dog-food-cadence.mjs';
import * as checkout from '../../lib/dog-food-checkout.mjs';
import {foodProfileComplete,FOOD_STATES} from '../../lib/dog-food-profile.mjs';
import {readFoodPlanning} from '../../lib/dog-food-sales-intelligence.mjs';
const source=path=>fs.readFileSync(new URL('../../'+path,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const pink='edf-22-12-pink-40',blue='edf-26-14-blue-40';
const row=(id,fields)=>({id,fields});
export function setup({bags=8}={}) {
  const yesterday=cadence.shiftFoodDays(logic.foodDate(),-1);
  const seed={tables:{Products:[row('recPink',{'Product Name':'Chicken Pink','Formula Code':'22-12','Bag Weight':40,'Retail Price':59,'Active Status':true,'Website Product ID':pink}),row('recBlue',{'Product Name':'Active Blue','Formula Code':'26-14','Bag Weight':40,'Retail Price':59,'Active Status':true,'Website Product ID':blue})],Sales:[],'Inventory Adjustments':[row('count-pink',{Product:['recPink'],'Movement Type':'Stock Count','Counted Quantity':bags,'Movement Date':yesterday}),row('count-blue',{Product:['recBlue'],'Movement Type':'Stock Count','Counted Quantity':bags,'Movement Date':yesterday})]}};
  const f=fixture(seed);
  f.sql.exec(fs.readFileSync(new URL('../../schema-proposals/0060_unified_food_sales.sql',import.meta.url),'utf8'));
  f.sql.exec(fs.readFileSync(new URL('../../schema-proposals/0061_food_sales_counts_customers.sql',import.meta.url),'utf8'));
  f.sql.exec(`UPDATE dog_food_sales_settings SET enabled=1,pricing_policy='catalog_lucas_775',approved_by='synthetic-owner',approved_at=CURRENT_TIMESTAMP,sng_enabled=1;
    UPDATE dog_food_products SET retail_price_cents=5900 WHERE is_active=1;
    UPDATE dog_food_products SET airtable_record_id='recPink' WHERE id='edf-22-12-pink-40';
    UPDATE dog_food_products SET airtable_record_id='recBlue' WHERE id='edf-26-14-blue-40';
    INSERT INTO dog_food_customers(id,first_name,last_name,email,phone,sng_client_id) VALUES('buyer','Synthetic','Buyer','buyer@example.test','4195550101','sng-client');
    INSERT INTO dog_food_addresses(id,customer_id,line1,city,state,postal_code,placement_preference) VALUES('address','buyer','123 Test','Toledo','OH','43614','Front door');
    INSERT INTO dog_food_accounts(id,email,customer_id,password_hash,profile_completed_at) VALUES('account','buyer@example.test','buyer','synthetic',CURRENT_TIMESTAMP);
    INSERT INTO route_partner_members(id,organization_id,email,display_name,role,status) VALUES('seller','org-opwp','seller@example.test','Synthetic Seller','viewer','active'),('other','org-opwp','other@example.test','Other Seller','viewer','active');
    INSERT INTO dog_food_sales_credentials(member_id,password_hash) VALUES('seller','synthetic-test-hash'),('other','synthetic-test-hash');
    INSERT INTO route_partner_field_credentials(member_id,pin_salt,pin_hash) VALUES('seller','salt','hash'),('other','salt','hash');
    INSERT INTO dog_food_sales_grants(member_id,organization_id,enabled,approved_by) VALUES('seller','org-opwp',1,'synthetic-owner'),('other','org-opwp',1,'synthetic-owner');`);
  for(const [id,p] of [['pink-lot',pink],['blue-lot',blue]])f.sql.prepare("INSERT INTO dog_food_stock_lots(id,product_id,lot_number,best_before,usable_bags,counted_date,confirmed_by) VALUES(?,?,?,'2030-01-01',?,?,'synthetic-owner')").run(id,p,id,bags,yesterday);
  const base={...logic,...account,...cadence,...checkout,...f.service,readFoodPlanning,foodProfileComplete,FOOD_STATES,crypto,TextEncoder,Date,Map,URL,JSON,console,readFoodDeliveryChoices:async()=>({deliveryAvailable:true,days:[{weekday:2}],tonyDates:[],capturedAt:null})};
  const fulfillment=vm.runInNewContext(source('lib/dog-food-fulfillment.js')+'\n({reserveFoodLots,checkFoodLotReconciliation,foodFulfillmentCommand})',base);
  const portal=vm.runInNewContext(source('lib/dog-food-portal.js')+'\n({readFoodPortal,createFoodPortalOrder})',{...base,...fulfillment});
  const service=ledger.createFoodSalesService({...f.service,...fulfillment});
  async function payload(extra={}) {
    const body={action:'save',commandId:crypto.randomUUID(),customerId:'buyer',items:[{productId:pink,quantity:1}],fulfillmentMethod:'pickup',fulfillmentStatus:'pending',billingProvider:'manual',amountReceivedCents:0,...extra};
    body.quoteHash=(await service.quote(f.db,body)).quoteHash;return body;
  }
  return {...f,...fulfillment,...portal,sales:service,payload,save:async extra=>service.command(f.db,await payload(extra),'seller')};
}
