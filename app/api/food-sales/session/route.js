import {NextResponse} from 'next/server';
import {foodSalesContext,salesHeaders,salesError} from '@/lib/food-sales-api';
import {authenticateFoodSales,activateFoodSalesPassword,foodSalesCookie,revokeFoodSalesSession} from '@/lib/food-sales-auth.mjs';
import {checkRateLimit,rateLimitResponse} from '@/lib/rate-limit';
import {readBoundedBytes} from '@/lib/bounded-body.mjs';
export const dynamic='force-dynamic';
export async function POST(request) {
  try {
    const c=await foodSalesContext(request,{write:true,login:true});if(c.response)return c.response;
    const body=JSON.parse(new TextDecoder().decode(await readBoundedBytes(request,4096)));
    if(body.action==='set_password')return Response.json({ok:true,...await activateFoodSalesPassword(c.env.DB,body)},{headers:salesHeaders});
    const email=typeof body.email==='string'?body.email.trim().toLowerCase():'',password=body.password;
    if(!email||email.length>254||typeof password!=='string'||!password||new TextEncoder().encode(password).length>256)return Response.json({error:'Enter your email and password.'},{status:400,headers:salesHeaders});
    const rate=await checkRateLimit(request,{scope:'food_sales_account_login',identity:email,limit:10,windowSeconds:900,failClosed:true});if(!rate.allowed)return rateLimitResponse(rate);
    const auth=await authenticateFoodSales(c.env.DB,email,password);
    if(!auth.authorized)return Response.json({error:auth.locked?'Too many attempts. Wait 15 minutes or contact the office.':'That email or password is not correct.'},{status:auth.locked?429:401,headers:salesHeaders});
    const response=NextResponse.json({ok:true,member:auth.member},{headers:salesHeaders});response.cookies.set(foodSalesCookie(auth.token,request.url));return response;
  }catch(error){return salesError(error);}
}
export async function DELETE(request) {
  try {
    const c=await foodSalesContext(request,{write:true});if(c.response)return c.response;
    await revokeFoodSalesSession(request.headers,c.env.DB);
    const response=NextResponse.json({ok:true},{headers:salesHeaders});response.cookies.set({...foodSalesCookie('',request.url),maxAge:0});return response;
  }catch(error){return salesError(error);}
}
