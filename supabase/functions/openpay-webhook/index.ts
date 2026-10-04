import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return json({error:"Método no permitido"},405);
 const url=Deno.env.get("SUPABASE_URL")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,merchant=Deno.env.get("OPENPAY_MERCHANT_ID"),privateKey=Deno.env.get("OPENPAY_PRIVATE_KEY");
 const admin=createClient(url,service,{auth:{persistSession:false}});
 try{
  const event=await req.json();
  if(event.type==="verification"||event.verification_code){const code=event.verification_code||event.transaction?.verification_code;const {data:cfg}=await admin.from("platform_configuration").select("organization_id").eq("singleton",true).single();if(cfg&&code)await admin.from("app_settings").update({openpay_webhook_verification_code:String(code),openpay_webhook_verified_at:new Date().toISOString()}).eq("organization_id",cfg.organization_id);return new Response(String(code||"ok"),{status:200})}
  if(!merchant||!privateKey)return json({error:"Credenciales Openpay no configuradas"},503);
  const transaction=event.transaction||{};const transactionId=String(transaction.id||event.transaction_id||"");if(!transactionId)return json({received:true,ignored:"Sin transacción"});
  const {data:cfg}=await admin.from("platform_configuration").select("organization_id").eq("singleton",true).single();const {data:settings}=await admin.from("app_settings").select("openpay_environment").eq("organization_id",cfg?.organization_id).single();const base=settings?.openpay_environment==="production"?"https://api.openpay.mx":"https://sandbox-api.openpay.mx";
  const response=await fetch(`${base}/v1/${merchant}/charges/${transactionId}`,{headers:{Authorization:`Basic ${btoa(`${privateKey}:`)}`}});const charge=await response.json();if(!response.ok)throw new Error(charge?.description||"No se pudo verificar el cargo");
  const orderId=String(charge.order_id||"");const {data:request,error}=await admin.from("service_requests").select("*").eq("payment_reference",orderId).maybeSingle();if(error||!request)return json({received:true,ignored:"Orden no localizada"});
  if(Number(charge.amount)!==Number(request.payment_amount)||String(charge.currency||"MXN")!==request.payment_currency)throw new Error("Monto o moneda no coinciden");
  await admin.from("payment_events").upsert({organization_id:request.organization_id,request_id:request.id,provider:"openpay",provider_event_id:`${event.type||"event"}:${transactionId}`,event_type:event.type||charge.status,amount:charge.amount,currency_code:charge.currency||"MXN",raw_payload:{event,verified_charge:charge}},{onConflict:"provider,provider_event_id"});
  if(charge.status==="completed"&&request.payment_status!=="paid"){
    await admin.from("service_requests").update({payment_status:"paid",status:"paid",payment_transaction_id:transactionId,payment_method:charge.payment_method?.type||charge.method||null,payment_paid_at:charge.operation_date||new Date().toISOString(),payment_error:null,document_status:"queued",invoice_status:request.invoice_requested?"pending_configuration":"not_requested"}).eq("id",request.id);
    const task=fetch(`${url}/functions/v1/generate-commercial-report`,{method:"POST",headers:{Authorization:`Bearer ${service}`,"Content-Type":"application/json"},body:JSON.stringify({request_id:request.id})}).then(async r=>{if(!r.ok)console.error("generate-commercial-report",await r.text())}).catch(console.error);
    // @ts-ignore
    if(globalThis.EdgeRuntime?.waitUntil)globalThis.EdgeRuntime.waitUntil(task);else await task;
  }else if(event.type==="charge.failed"||charge.status==="failed")await admin.from("service_requests").update({payment_status:"failed",payment_error:charge.error_message||"Pago rechazado"}).eq("id",request.id);
  else if(event.type==="charge.cancelled"||charge.status==="cancelled")await admin.from("service_requests").update({payment_status:"cancelled",payment_error:"Pago cancelado"}).eq("id",request.id);
  else if(event.type==="charge.refunded"||charge.status==="refunded")await admin.from("service_requests").update({payment_status:"refunded",invoice_status:request.invoice_requested?"cancelled":"not_requested"}).eq("id",request.id);
  return json({received:true});
 }catch(error){console.error(error);return json({error:error instanceof Error?error.message:"Error inesperado"},500)}
});