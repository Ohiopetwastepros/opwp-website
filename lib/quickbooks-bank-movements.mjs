import { cents, providerId, bankDate } from './bank-reconciliation.mjs';

// Normalize supported cash movements, not revenue. Each transfer has two signed legs.
export function quickBooksBankMovements({deposits=[],payments=[],purchases=[],transfers=[]}) {
  const result=[];
  function add(kind,row,account,amount) {
    if(!account?.value) return; // Undeposited funds without a bank reference cannot match cash.
    if(row.CurrencyRef && row.CurrencyRef.value!=='USD') return;
    const signedCents=cents(amount);
    result.push({Id:`${kind}_${providerId(String(row.Id))}`,DepositToAccountRef:{value:providerId(String(account.value))},TotalAmt:signedCents/100,TxnDate:bankDate(row.TxnDate),kind});
  }
  for(const row of deposits) add('Deposit',row,row.DepositToAccountRef,row.TotalAmt);
  for(const row of payments) add('Payment',row,row.DepositToAccountRef,row.TotalAmt);
  for(const row of purchases) add('Purchase',row,row.AccountRef,cents(row.TotalAmt)/100*(row.Credit===true?1:-1));
  for(const row of transfers) {
    const amount=cents(row.Amount)/100;
    if(amount<0) throw new Error('Invalid transfer amount.');
    add('TransferIn',row,row.ToAccountRef,amount);
    add('TransferOut',row,row.FromAccountRef,-amount);
  }
  return result;
}
