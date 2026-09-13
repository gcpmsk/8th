/* Authenticated owner decisions. Never accepts arbitrary recipient/text. */
import { Client } from 'pg';
const headers = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' };
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers});
function authorized(request,env) {
  return env.WA_ADMIN_TOKEN && request.headers.get('Authorization') === 'Bearer '+env.WA_ADMIN_TOKEN;
}
async function connect(env) {
  const url=env.DATABASE_URL||env.POSTGRES_URL||env.PG_URL;
  if(!url) throw new Error('DATABASE_URL missing');
  const c=new Client({connectionString:url,connectionTimeoutMillis:8000}); await c.connect(); return c;
}
export async function onRequestGet({request,env}) {
  if(!authorized(request,env)) return json({ok:false,error:'Owner access key required'},401);
  let c;
  try {
    c=await connect(env);
    const r=await c.query(`SELECT x || jsonb_build_object('delivery',COALESCE(d.delivery,'pending'),'deliveryError',d.last_error) AS obj
      FROM sg_store s CROSS JOIN LATERAL jsonb_array_elements(s.value->'v') x
      LEFT JOIN wa_decisions d ON d.objection_id=x->>'id' WHERE s.key='sg_wa_obj'`);
    return json({ok:true,objects:r.rows.map(x=>x.obj)});
  } catch(e) { return json({ok:false,error:e.message},502); }
  finally { await c?.end().catch(()=>{}); }
}
export async function onRequestPost({request,env}) {
  if(!authorized(request,env)) return json({ok:false,error:'Owner access key required'},401);
  let c;
  try {
    const b=await request.json();
    if(!b.id || !['accept','set','deny','retry'].includes(b.action)) return json({ok:false,error:'id/action required'},400);
    const rate=b.action==='set'?Number(b.rate):null;
    if(b.action==='set' && (!Number.isFinite(rate)||rate<=0||rate>9999999.99||Math.abs(rate*100-Math.round(rate*100))>0.000001)) return json({ok:false,error:'Valid rate with at most 2 decimals required'},400);
    c=await connect(env);
    await c.query("SET lock_timeout='8s'");
    // Serialize resolution + send for double taps. Decision itself is a DB transaction.
    await c.query('SELECT pg_advisory_lock(hashtextextended($1,0))',['wa:decision:'+b.id]);
    const result=(await c.query('SELECT wa_resolve($1,$2,$3) AS result',[b.id,b.action,rate])).rows[0].result;
    const d=(await c.query('SELECT * FROM wa_decisions WHERE objection_id=$1',[b.id])).rows[0];
    if(d.delivery==='accepted') return json({ok:true,saved:true,sent:true,result});
    try {
      if(!env.WA_TOKEN||!env.WA_PHONE_ID) throw new Error('WA_TOKEN / WA_PHONE_ID missing; decision saved, retry after configuration');
      const recent=(await c.query("SELECT 1 FROM wa_inbox WHERE phone=$1 AND created_at>now()-interval '24 hours' LIMIT 1",[d.phone])).rows.length;
      let payload={type:'text',text:{body:d.message}};
      if(!recent) {
        if(!env.WA_OBJECTION_TEMPLATE) throw new Error('24-hour window closed: configure approved WA_OBJECTION_TEMPLATE, or ask customer to send Hi then Retry');
        const values=[result.name,result.rno,result.item,result.oldRate,result.finalRate,result.decision,result.newTotal];
        payload={type:'template',template:{name:env.WA_OBJECTION_TEMPLATE,language:{code:env.WA_TEMPLATE_LANG||'hi'},
          components:[{type:'body',parameters:values.map(v=>({type:'text',text:String(v)}))}]}};
      }
      const r=await fetch(`https://graph.facebook.com/${env.WA_GRAPH_VERSION || 'v23.0'}/${env.WA_PHONE_ID}/messages`,{
        method:'POST',headers:{Authorization:'Bearer '+env.WA_TOKEN,'Content-Type':'application/json'},
        body:JSON.stringify({messaging_product:'whatsapp',to:d.phone,...payload})});
      const out=await r.json();
      if(!r.ok||out.error||!out.messages?.[0]?.id) throw new Error(`Meta ${out.error?.code||r.status}: ${out.error?.message||'No message ID returned'}`);
      await c.query("UPDATE wa_decisions SET delivery='accepted',meta_id=$2,last_error=NULL,updated_at=now() WHERE objection_id=$1",[b.id,out.messages[0].id]);
      return json({ok:true,saved:true,sent:true,result});
    } catch(e) {
      await c.query("UPDATE wa_decisions SET delivery='failed',last_error=$2,updated_at=now() WHERE objection_id=$1",[b.id,e.message]);
      return json({ok:true,saved:true,sent:false,error:e.message,result});
    }
  } catch(e) { return json({ok:false,error:e.message},409); }
  finally { await c?.end().catch(()=>{}); }
}
