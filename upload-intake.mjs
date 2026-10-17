const supported = /^(application\/pdf|image\/(jpeg|png|webp))$/;
const fail = result => { if(result.error) throw new Error(result.error.message); return result.data; };
export async function captureFingerprint(payload,userId) {
  if(!userId)throw new Error('Inicia sesión antes de preparar el expediente.');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({payload,userId}))))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function validateIntakeFiles(files) {
  let images=0;
  for(const file of files){
    if(!supported.test(file.type))throw new Error('Adjunta únicamente PDF, JPG, PNG o WebP.');
    if(file.size>40*1024*1024)throw new Error('Cada archivo debe pesar como máximo 40 MB.');
    if(file.type.startsWith('image/'))images+=file.size;
  }
  if(images>30*1024*1024)throw new Error('Las fotografías deben sumar como máximo 30 MB; reduce su tamaño antes de pagar.');
}
export async function uploadIntakeFiles(db,userId,requestId,files,onProgress=()=>{}) {
  validateIntakeFiles(files);
  if(!files.length)return [];
  if(!userId)throw new Error('Inicia sesión antes de cargar la evidencia.');
  const row=fail(await db.from('service_requests').select('organization_id').eq('id',requestId).single());
  if(!row?.organization_id)throw new Error('No se pudo comprobar la organización del expediente.');
  const prior=fail(await db.from('intake_documents').select('storage_path').eq('request_id',requestId))||[];
  const paths=new Set(prior.map(r=>r.storage_path)),saved=[];
  for(const [index,file] of files.entries()){
    onProgress(index+1,files.length);
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const name=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
    const path=`${row.organization_id}/${requestId}/${hash}-${name}`;
    if(!paths.has(path)){
      const upload=await db.storage.from('valuation-intake').upload(path,file,{contentType:file.type,upsert:false});
      // Retry after a successful object upload but a failed row insert. Exact
      // bytes + request-scoped digest path identify the same retained object.
      if(upload.error&&String(upload.error.statusCode)!=='409')throw new Error(upload.error.message);
      fail(await db.from('intake_documents').insert({organization_id:row.organization_id,request_id:requestId,uploaded_by:userId,
        category:file.type.startsWith('image/')?'fotografia':'otro',file_name:file.name,storage_path:path,mime_type:file.type,size_bytes:file.size}));
      paths.add(path);
    }
    saved.push(path);
  }
  return saved;
}
