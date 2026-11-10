import {foodSalesContext,salesHeaders,salesError} from '@/lib/food-sales-api';
import {foodCustomerCommand,foodCustomerMessages} from '@/lib/food-customer-hub.mjs';
import {flushFoodCustomerMessages} from '@/lib/food-customer-service';
import {readBoundedBytes} from '@/lib/bounded-body.mjs';
import {FoodError} from '@/lib/dog-food-operations.mjs';
export const dynamic='force-dynamic';
export async function POST(request){
  try{
    const c=await foodSalesContext(request,{write:true});if(c.response)return c.response;
    const body=JSON.parse(new TextDecoder().decode(await readBoundedBytes(request,16384)));
    if(!body||body.action!=='create_customer')throw new FoodError('Only creating a customer is allowed here.',403);
    const result=await foodCustomerCommand(c.env.DB,body,c.auth.member.id);
    try{await flushFoodCustomerMessages(c.env,{customerId:result.id,limit:2});}catch{/* The durable queue remains visible to the office. */}
    const customer=await c.env.DB.prepare('SELECT id,first_name,last_name,email,phone FROM dog_food_customers WHERE id=?').bind(result.id).first();
    return Response.json({ok:true,result,customer,messages:await foodCustomerMessages(c.env.DB,result.id)},{headers:salesHeaders});
  }catch(error){return salesError(error);}
}
