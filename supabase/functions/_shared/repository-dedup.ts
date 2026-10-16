type Row=Record<string,any>;
export function duplicatePlan(sources:Row[]):Row[]{
  const groups=new Map<string,Row[]>();
  for(const source of sources){
    if(!source.verified_hash)continue;
    const key=source.organization_id+'|'+source.source_type+'|'+source.verified_hash;
    groups.set(key,[...(groups.get(key)||[]),source]);
  }
  const score=(s:Row)=>(s.analysis?.commercial_evidence?.complete?1000000:0)
    +Number(s.analysis?.commercial_evidence?.completed_pages||0)*100+(s.status==='ready'?10:0);
  return [...groups.values()].flatMap(group=>{
    group.sort((a,b)=>score(b)-score(a)||String(a.created_at).localeCompare(String(b.created_at))||a.id.localeCompare(b.id));
    return group.slice(1).map(duplicate=>({duplicate,keep:group[0]}));
  });
}
