// Sends push notifications to people's phones. Called by the BBTNF app when an admin acts.
const webpush = require('web-push');
const crypto = require('crypto');

const PROJECT = 'bbtnf-fines-bf27b';
const ORGANISER_HASH = '1225b5e5297f0bce34f2010d99b59a7298f4a6f72f2ec2ad7ca69bd0849c29c2';
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BP9VZOAbmvpezMVOjhzEHf3wmWvweNxTetEASqhFSv5p51v6LFx0o1Uulqe4mqLlT9H7QCUw3Yw0NUyye4YeM6k';

function decode(v){
  if(v === undefined || v === null) return null;
  if('stringValue' in v) return v.stringValue;
  if('integerValue' in v) return Number(v.integerValue);
  if('doubleValue' in v) return v.doubleValue;
  if('booleanValue' in v) return v.booleanValue;
  if('nullValue' in v) return null;
  if('timestampValue' in v) return v.timestampValue;
  if('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if('mapValue' in v){ const o = {}; const f = v.mapValue.fields || {}; Object.keys(f).forEach(k => { o[k] = decode(f[k]); }); return o; }
  return null;
}
async function loadLeague(fetchFn){
  const r = await fetchFn('https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/league/main');
  if(!r.ok) throw new Error('Could not read the league (' + r.status + ')');
  const j = await r.json();
  return decode({ mapValue:{ fields:j.fields || {} } }) || {};
}
const sha = s => crypto.createHash('sha256').update('bbtnf:' + s).digest('hex');

function isAllowed(league, auth){
  if(!auth) return false;
  if(auth.code && sha(String(auth.code)) === ORGANISER_HASH) return true;
  const m = (league.members || {})[auth.pid];
  return !!(m && m.admin && m.pin && String(m.pin) === String(auth.pin));
}

async function run(body, deps){
  deps = deps || {};
  const fetchFn = deps.fetch || fetch, wp = deps.webpush || webpush;
  const priv = deps.privateKey || process.env.VAPID_PRIVATE_KEY;
  if(!priv) return { status:500, json:{ error:'VAPID_PRIVATE_KEY is not set in Vercel yet' } };
  const league = await loadLeague(fetchFn);
  if(!isAllowed(league, body.auth)) return { status:403, json:{ error:'Not allowed' } };
  const msgs = Array.isArray(body.messages) ? body.messages.slice(0, 40) : [];
  if(!msgs.length) return { status:400, json:{ error:'No messages' } };
  wp.setVapidDetails('mailto:info@exteriorcleaningco.com', VAPID_PUBLIC, priv);
  const members = league.members || {}, seen = {}, jobs = [];
  msgs.forEach(msg => {
    const pids = Array.isArray(msg.pids) ? msg.pids : Object.keys(members);
    pids.forEach(pid => {
      const subs = (members[pid] && members[pid].push) || [];
      (Array.isArray(subs) ? subs : []).forEach(sub => {
        if(!sub || !sub.endpoint || seen[sub.endpoint]) return;
        seen[sub.endpoint] = true;
        jobs.push({ sub, payload: JSON.stringify({ title:String(msg.title || 'BBTNF').slice(0, 80), body:String(msg.body || '').slice(0, 200), url:'/', tag:msg.tag || undefined }) });
      });
    });
  });
  let sent = 0, failed = 0;
  await Promise.all(jobs.map(j => wp.sendNotification(j.sub, j.payload).then(() => { sent++; }).catch(() => { failed++; })));
  return { status:200, json:{ sent, failed, devices:jobs.length } };
}

module.exports = async function handler(req, res){
  if(req.method !== 'POST'){ res.status(405).json({ error:'POST only' }); return; }
  try{
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const out = await run(body);
    res.status(out.status).json(out.json);
  }catch(e){ res.status(500).json({ error:String(e && e.message || e) }); }
};
module.exports.run = run;
module.exports.decode = decode;
