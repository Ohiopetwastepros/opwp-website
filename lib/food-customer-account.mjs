// A directory/profile record is not a login or billing account. These are the
// model's existing verified portal and explicitly linked billing identities.
// The read-only flag never creates an account or grants billing authorization.
export async function foodEstablishedAccountSql(db,customerAlias='c'){
  if(!/^[a-z][a-z0-9_]*$/i.test(customerAlias))throw new TypeError('Invalid customer alias.');
  const c=customerAlias;
  const linkedSources=Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dog_food_source_customer_links'").first());
  return `(NULLIF(trim(${c}.sng_client_id),'') IS NOT NULL OR NULLIF(trim(${c}.stripe_customer_id),'') IS NOT NULL
    OR EXISTS(SELECT 1 FROM dog_food_accounts established_account WHERE established_account.customer_id=${c}.id AND NULLIF(trim(established_account.verified_at),'') IS NOT NULL)
    ${linkedSources?`OR EXISTS(SELECT 1 FROM dog_food_source_customer_links established_source WHERE established_source.customer_id=${c}.id AND established_source.provider IN('sweep_and_go','stripe') AND NULLIF(trim(established_source.external_id),'') IS NOT NULL)`:''})`;
}
export function foodCustomerAccountState(customer){
  const establishedAccount=Number(customer?.established_account)===1;
  return {establishedAccount,needsAccountCreated:!establishedAccount};
}
