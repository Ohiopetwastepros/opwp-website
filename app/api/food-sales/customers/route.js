import {foodSalesContext,salesHeaders,salesError} from '@/lib/food-sales-api';
import {foodCustomerCommand,foodCustomerMessages,readStaffFoodCustomerIntake} from '@/lib/food-customer-hub.mjs';
import {readBoundedBytes} from '@/lib/bounded-body.mjs';
import {FoodError} from '@/lib/dog-food-operations.mjs';
export const dynamic='force-dynamic';
export async function GET(request){try{const c=await foodSalesContext(request);if(c.response)return c.response;return Response.json({ok:true,customer:await readStaffFoodCustomerIntake(c.env.DB,new URL(request.url).searchParams.get('id'))},{headers:salesHeaders});}catch(error){return salesError(error);}}
export async function POST(request){
  try{
    const c=await foodSalesContext(request,{write:true});if(c.response)return c.response;
    const body=JSON.parse(new TextDecoder().decode(await readBoundedBytes(request,16384)));
    if(!body||!['create_customer','update_customer'].includes(body.action))throw new FoodError('Only customer intake is allowed here.',403);
    const result=await foodCustomerCommand(c.env.DB,body,c.auth.member.id,{staffIntake:true});
    const customer=await readStaffFoodCustomerIntake(c.env.DB,result.id);
    return Response.json({ok:true,result,customer,messages:await foodCustomerMessages(c.env.DB,result.id)},{headers:salesHeaders});
  }catch(error){return salesError(error);}
}
