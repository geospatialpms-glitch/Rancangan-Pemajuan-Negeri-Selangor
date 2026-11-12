#!/usr/bin/env node
// Fetch real GA4 unique visitors for the Story Map and publish a safe public JSON snapshot.
// Required GitHub Actions secret: GA4_SERVICE_ACCOUNT_JSON; property ID supplied by workflow
// Never publish the service account key to the repository.
import {createSign} from 'node:crypto';
import {writeFile, mkdir} from 'node:fs/promises';

const keyJson=process.env.GA4_SERVICE_ACCOUNT_JSON;
const propertyId=process.env.GA4_PROPERTY_ID;
if(!keyJson || !/^\d+$/.test(propertyId||'')) {
  throw Error('Configure GA4_SERVICE_ACCOUNT_JSON and numeric GA4_PROPERTY_ID in GitHub Actions secrets.');
}
const credentials=JSON.parse(keyJson);
if(!credentials.client_email || !credentials.private_key)throw Error('Invalid service account JSON');
const b64=data=>Buffer.from(JSON.stringify(data)).toString('base64url');
const now=Math.floor(Date.now()/1000);
const claim={iss:credentials.client_email,scope:'https://www.googleapis.com/auth/analytics.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600};
const tokenBody=b64({alg:'RS256',typ:'JWT'})+'.'+b64(claim);
const sign=createSign('RSA-SHA256');sign.update(tokenBody);sign.end();
const jwt=tokenBody+'.'+sign.sign(credentials.private_key,'base64url');
const oauth=await fetch('https://oauth2.googleapis.com/token',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt})
});
if(!oauth.ok)throw Error('Google OAuth refused access: '+oauth.status+' '+(await oauth.text()).slice(0,500));
const {access_token:token}=await oauth.json();

const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'});
const parts=Object.fromEntries(formatter.formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
const date=parts.year+'-'+parts.month+'-'+parts.day;
const pagePath='/Rancangan-Pemajuan-Negeri-Selangor/ai-storymap/';
async function report(startDate,endDate){
  const body={
    dateRanges:[{startDate,endDate}],
    metrics:[{name:'totalUsers'}],
    dimensionFilter:{filter:{fieldName:'pagePath',stringFilter:{matchType:'EXACT',value:pagePath}}},
    limit:'1'
  };
  const result=await fetch('https://analyticsdata.googleapis.com/v1beta/properties/'+propertyId+':runReport',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  if(!result.ok)throw Error('GA4 Data API '+result.status+': '+(await result.text()).slice(0,600));
  const payload=await result.json();
  const val=Number(payload.rows?.[0]?.metricValues?.[0]?.value ?? 0);
  if(!Number.isSafeInteger(val)||val<0)throw Error('Unexpected GA4 unique visitor count');
  return val;
}
// GA4 historical start: property history is only counted from installation.
const [today,total]=await Promise.all([report(date,date),report('2020-01-01',date)]);
const output={source:'GA4',metric:'totalUsers',path:pagePath,date,today,total,updatedAt:new Date().toISOString()};
await mkdir('ai-storymap',{recursive:true});
await writeFile('ai-storymap/visitor-stats.json',JSON.stringify(output,null,2)+'\n','utf8');
console.log('GA4 visitor snapshot generated for',date,'unique visitors today:',today,'period unique visitors:',total);
