import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const splitName=(full:string)=>{const parts=full.trim().split(/\s+/);return {name:parts.shift()||"Cliente",last_name:parts.join(" ")||"ValoraIA"}};

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const admin=createClient(url,service,{auth:{persistSession:false}});
 if(req.method==="GET"){
  const merchant=Deno.env.get("OPENPAY_MERCHANT_ID"),privateKey=Deno.env.get("OPENPAY_PRIVATE_KEY");
  if(!merchant||!privateKey) return json({configured:false,reachable:false,environment:"sandbox"},503);
  try{
   const {data:cfg}=await admin.from("platform_configuration").select("organization_id").eq("singleton",true).single();
   const {data:settings}=await admin.from("app_settings").select("openpay_environment").eq("organization_id",cfg?.organization_id).single();
   const environment=settings?.openpay_environment==="production"?"production":"sandbox";
   const base=environment==="production"?"https://api.openpay.mx":"https://sandbox-api.openpay.mx";
   const response=await fetch(`${base}/v1/${merchant}`,{headers:{Authorization:`Basic ${btoa(`${privateKey}:`)}`}});
   return json({configured:true,reachable:response.ok,environment},response.ok?200:502);
  }catch(error){
   console.error("openpay-health",error);
   return json({configured:true,reachable:false,environment:"unknown"},502);
  }
 }
 if(req.method!=="POST") return json({error:"Método no permitido"},405);
 const auth=req.headers.get("Authorization"); if(!auth) return json({error:"Autenticación requerida"},401);
 const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
 try{
  const {data:{user},error:userError}=await userClient.auth.getUser(); if(userError||!user) return json({error:"Sesión inválida"},401);
  const body=await req.json(); const requestId=String(body.request_id||""); if(!requestId) return json({error:"request_id es obligatorio"},400);
  const {data:row,error}=await admin.from("service_requests").select("*,valuation_cases(folio)").eq("id",requestId).single();
  if(error||!row) return json({error:"Solicitud no encontrada"},404);
  if(row.created_by!==user.id) return json({error:"Sin acceso a esta solicitud"},403);
  if(row.service_type!=="commercial") return json({error:"Esta solicitud no requiere pago comercial"},400);
  if(row.payment_status==="paid") return json({status:"paid",request_id:requestId});
  const merchant=Deno.env.get("OPENPAY_MERCHANT_ID"),privateKey=Deno.env.get("OPENPAY_PRIVATE_KEY");
  if(!merchant||!privateKey) return json({error:"Openpay todavía no está configurado. Agrega OPENPAY_MERCHANT_ID y OPENPAY_PRIVATE_KEY en los secretos de Supabase."},503);
  const {data:settings}=await admin.from("app_settings").select("openpay_environment,commercial_price,currency_code").eq("organization_id",row.organization_id).single();
  const environment=settings?.openpay_environment==="production"?"production":"sandbox";
  const base=environment==="production"?"https://api.openpay.mx":"https://sandbox-api.openpay.mx";
  const testMode=body.test_mode===true;
  if(testMode){
    if(environment!=="sandbox") return json({error:"La prueba de $1 solo está disponible en sandbox."},403);
    const {data:member,error:memberError}=await admin.from("organization_members").select("role,status").eq("organization_id",row.organization_id).eq("user_id",user.id).maybeSingle();
    if(memberError||member?.status!=="active"||!["owner","admin"].includes(member.role)) return json({error:"La prueba de $1 requiere una cuenta administradora."},403);
  } else if(row.intake_data?.internal_test===true) return json({error:"Esta solicitud de prueba requiere el modo sandbox."},409);
  const amount=testMode?1:Number(row.payment_amount);
  if(!Number.isFinite(amount)||amount<=0||row.payment_currency!=="MXN") return json({error:"El monto de la solicitud no es válido."},409);
  if(!testMode&&Number(settings?.commercial_price)!==amount) return json({error:"El precio cambió desde que se creó la solicitud. Inicia una nueva."},409);
  if(row.payment_checkout_url&&row.payment_checkout_created_at){
    if(Number(row.payment_amount)!==amount) return json({error:"Esta solicitud ya tiene una liga con otro monto."},409);
    if(Date.now()-new Date(row.payment_checkout_created_at).getTime()<30*60*1000) return json({checkout_url:row.payment_checkout_url,reused:true});
  }
  const orderId=`VAL-${requestId}`.slice(0,100); const names=splitName(row.client_name||"");
  const publicUrl=(Deno.env.get("VALORAIA_PUBLIC_URL")||"https://valoraia.onrender.com").replace(/\/$/,"");
  const redirectUrl=`${publicUrl}/servicios.html?tipo=comercial&pago=regreso&solicitud=${encodeURIComponent(requestId)}`;
  const payload={amount:amount.toFixed(2),currency:"MXN",description:`Opinión de valor comercial ${row.valuation_cases?.folio||"ValoraIA"}`,order_id:orderId,customer:{...names,email:row.client_email,phone_number:row.client_phone||undefined},redirect_url:redirectUrl};
  const response=await fetch(`${base}/v1/${merchant}/checkouts`,{method:"POST",headers:{Authorization:`Basic ${btoa(`${privateKey}:`)}`,"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const result=await response.json(); if(!response.ok) throw new Error(result?.description||result?.message||"Openpay rechazó la creación del checkout");
  const checkoutUrl=result.checkout_link||result.payment_method?.url; if(!checkoutUrl) throw new Error("Openpay no devolvió la liga de pago");
  const update=await admin.from("service_requests").update({payment_provider:"openpay",payment_amount:amount,payment_reference:orderId,payment_checkout_url:checkoutUrl,payment_checkout_created_at:new Date().toISOString(),payment_error:null,...(testMode?{intake_data:{...(row.intake_data||{}),internal_test:true}}:{})}).eq("id",requestId);
  if(update.error) throw update.error;
  return json({checkout_url:checkoutUrl,request_id:requestId,amount,currency:"MXN",environment});
 }catch(error){console.error(error);return json({error:error instanceof Error?error.message:"Error inesperado"},500)}
});
