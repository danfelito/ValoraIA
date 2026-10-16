import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.110.8';
import {duplicatePlan} from '../_shared/repository-dedup.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json','Cache-Control':'no-store'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return json({error:'Método no permitido'},405);
  try{
    const auth=req.headers.get('Authorization');if(!auth)return json({error:'Acceso requerido'},401);
    const url=Deno.env.get('SUPABASE_URL')!;
    const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}}});
    const user=await client.auth.getUser();if(user.error||!user.data.user)return json({error:'Sesión inválida'},401);
    const body=await req.json(),orgId=String(body.organization_id||'');
    const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
    const member=await admin.from('organization_members').select('role').eq('organization_id',orgId).eq('user_id',user.data.user.id).eq('status','active').maybeSingle();
    if(member.error||!['owner','admin'].includes(member.data?.role))return json({error:'Sin acceso'},403);
    const query=await admin.from('knowledge_sources').select('*').eq('organization_id',orgId).neq('status','archived');if(query.error)throw query.error;
    const sources=[];
    for(const source of query.data||[]){
      let hash='';
      if(source.source_type==='pdf'){
        if(!source.storage_path?.startsWith(orgId+'/'))throw new Error('Ruta de archivo no válida');
        const file=await admin.storage.from('valuation-knowledge').download(source.storage_path);if(file.error||!file.data)throw file.error||new Error('No se pudo comprobar el archivo');
        hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.data.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
      }else hash=source.source_url;
      sources.push({...source,verified_hash:hash});
    }
    const plan=duplicatePlan(sources);
    if(body.action!=='archive')return json({duplicates:plan.map(p=>({id:p.duplicate.id,title:p.duplicate.title,keep_id:p.keep.id,hash:p.duplicate.verified_hash}))});
    const archived=[];
    for(const {duplicate,keep} of plan){
      const r=await admin.from('knowledge_sources').update({status:'archived',analysis:{...(duplicate.analysis||{}),duplicate_of:keep.id,archive_reason:'duplicate_sha256',previous_status:duplicate.status}}).eq('id',duplicate.id).eq('organization_id',orgId).neq('status','archived');
      if(r.error)throw r.error;archived.push({id:duplicate.id,keep_id:keep.id,title:duplicate.title});
    }
    return json({archived,count:archived.length,message:'Duplicados retirados del repositorio activo. Los originales se conservan y pueden restaurarse.'});
  }catch(error){return json({error:error instanceof Error?error.message:'No se pudo comprobar el repositorio'},500);}
});
