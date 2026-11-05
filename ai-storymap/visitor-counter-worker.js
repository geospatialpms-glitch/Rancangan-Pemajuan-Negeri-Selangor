/**
 * Rancangan Pemajuan Negeri Selangor — Shared Story Map visitor counter
 * Cloudflare Worker + D1 database (DB binding).
 *
 * Set an environment binding named DB to a D1 database.
 * D1 table is created automatically on first request.
 * Configure the deployed Worker URL in ai-storymap/index.html:
 *   data-counter-api="https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
 *
 * Visits count page opens, NOT verified unique human visitors.
 * Dates use the Asia/Kuala_Lumpur calendar. A new page load increments
 * exactly once on POST /visit; GET /stats never increments.
 */
const ALLOWED_ORIGIN = 'https://geospatialpms-glitch.github.io';
const ALLOWED_PATH = '/Rancangan-Pemajuan-Negeri-Selangor/ai-storymap/';
function headers(origin) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
function response(obj,status,origin) {
  return new Response(JSON.stringify(obj), {status, headers: headers(origin)});
}
function todayMY() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return v.year+'-'+v.month+'-'+v.day;
}
async function setup(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS visits (day TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0)').run();
}
async function totals(db,date) {
  const rows = await db.prepare('SELECT day, count FROM visits WHERE day = ? OR day = ?')
    .bind(date,'__all__').all();
  const found=Object.fromEntries((rows.results||[]).map(r=>[r.day,Number(r.count)]));
  return {date,today:found[date]||0,total:found.__all__||0};
}
export default {
  async fetch(request,env) {
    const origin=request.headers.get('Origin')||'';
    if(request.method==='OPTIONS') {
      return new Response(null,{status:204,headers:headers(origin)});
    }
    if(!env.DB)return response({error:'D1 database is not bound'},503,origin);
    const url=new URL(request.url);
    if(url.pathname!== '/visit' && url.pathname!== '/stats')return response({error:'Not found'},404,origin);
    if(origin && origin!==ALLOWED_ORIGIN)return response({error:'Forbidden origin'},403,origin);
    if(url.pathname==='/visit' && request.method!=='POST')return response({error:'Method not allowed'},405,origin);
    if(url.pathname==='/stats' && request.method!=='GET')return response({error:'Method not allowed'},405,origin);
    if(url.pathname==='/visit') {
      const body=await request.json().catch(()=>null);
      if(!body || body.path!==ALLOWED_PATH)return response({error:'Invalid Story Map path'},400,origin);
    }
    try {
      await setup(env.DB);
      const date=todayMY();
      if(url.pathname==='/visit'){
        // D1 batch is transactional, avoiding lost increments across visitors.
        await env.DB.batch([
          env.DB.prepare('INSERT INTO visits(day,count) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET count=count+1').bind(date),
          env.DB.prepare("INSERT INTO visits(day,count) VALUES ('__all__',1) ON CONFLICT(day) DO UPDATE SET count=count+1")
        ]);
      }
      return response(await totals(env.DB,date),200,origin);
    } catch(e){
      console.error('Visitor counter error',e);
      return response({error:'Counter service temporarily unavailable'},503,origin);
    }
  }
};
