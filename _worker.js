// Web Push transport. VAPID credentials must be configured as Cloudflare secrets.
const enc=new TextEncoder();
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
const concat=(...a)=>{const b=new Uint8Array(a.reduce((n,x)=>n+x.length,0));let i=0;for(const x of a){b.set(x,i);i+=x.length}return b};
function pushConfigured(env){return !!(env.PUSH_PUBLIC_KEY&&env.PUSH_PRIVATE_KEY&&env.PUSH_CONTACT)}
function validSubscription(s){try{const u=new URL(s.endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&s.endpoint.length<2048&&(/^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)$/.test(u.hostname)||/^[a-z0-9-]+\.push\.apple\.com$/.test(u.hostname)||/^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname))&&unb(s.keys.p256dh).length===65&&unb(s.keys.auth).length===16}catch{return false}}
async function tables(env){await env.DB.prepare('CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY,uid TEXT NOT NULL,role TEXT NOT NULL,data TEXT NOT NULL)').run()}
async function subscription(env,uid,role,s,remove=false){await tables(env);if(remove){await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND uid=? AND role=?').bind(s.endpoint,uid,role).run();return true}if(!validSubscription(s)||!pushConfigured(env))return false;const old=await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE uid=? AND role=?').bind(uid,role).first();const existing=await env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE endpoint=? AND uid=? AND role=?').bind(s.endpoint,uid,role).first();if(!existing&&Number(old?.n)>=10)return false;await env.DB.prepare('INSERT INTO push_subscriptions(endpoint,uid,role,data) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET uid=excluded.uid,role=excluded.role,data=excluded.data').bind(s.endpoint,uid,role,JSON.stringify(s)).run();return true}
async function hkdf(salt,ikm,info,n){const k=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},k,n*8))}
async function encryptedPayload(s,payload){const client=unb(s.keys.p256dh),pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),server=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)),pub=await crypto.subtle.importKey('raw',client,{name:'ECDH',namedCurve:'P-256'},false,[]),secret=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:pub},pair.privateKey,256)),salt=crypto.getRandomValues(new Uint8Array(16)),ikm=await hkdf(unb(s.keys.auth),secret,concat(enc.encode('WebPush: info\0'),client,server),32),key=await hkdf(salt,ikm,enc.encode('Content-Encoding: aes128gcm\0'),16),nonce=await hkdf(salt,ikm,enc.encode('Content-Encoding: nonce\0'),12),aes=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']),ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},aes,concat(enc.encode(JSON.stringify(payload)),new Uint8Array([2]))));return concat(salt,new Uint8Array([0,0,16,0,65]),server,ct)}
async function send(env,s,payload){const publicKey=unb(env.PUSH_PUBLIC_KEY),jwk={kty:'EC',crv:'P-256',x:b64(publicKey.slice(1,33)),y:b64(publicKey.slice(33,65)),d:env.PUSH_PRIVATE_KEY,ext:true},key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']),head=b64(enc.encode(JSON.stringify({typ:'JWT',alg:'ES256'}))),claims=b64(enc.encode(JSON.stringify({aud:new URL(s.endpoint).origin,exp:Math.floor(Date.now()/1000)+3600,sub:env.PUSH_CONTACT}))),input=head+'.'+claims,sig=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(input)));return fetch(s.endpoint,{method:'POST',redirect:'error',headers:{Authorization:`vapid t=${input}.${sig}, k=${env.PUSH_PUBLIC_KEY}`,'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',TTL:'300',Urgency:'high'},body:await encryptedPayload(s,payload)})}
async function pushEvent(env,role,uid,payload){if(!pushConfigured(env))return {attempted:0,accepted:0};await tables(env);const rows=(await env.DB.prepare('SELECT endpoint,data FROM push_subscriptions WHERE role=? AND (? IS NULL OR uid=?) LIMIT 20').bind(role,uid,uid).all()).results;const results=await Promise.allSettled(rows.map(async r=>{const s=JSON.parse(r.data);if(!validSubscription(s))return false;const res=await send(env,s,{...payload,path:role==='merchant'?'/merchant':'/'});if([404,410].includes(res.status))await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(r.endpoint).run();return res.ok}));return {attempted:rows.length,accepted:results.filter(x=>x.status==='fulfilled'&&x.value===true).length}}

// Pages advanced-mode Worker. The build embeds the menu, not secrets.

const MENU = [{"id":1,"category":"Chinese Rice Bowls","name":"Chilli Mushroom Rice Bowl (600 ml)","description":"Mushrooms tossed in a spicy chilli sauce, served with rice.","original":198,"price":159,"veg":true},{"id":2,"category":"Chinese Rice Bowls","name":"Chilli Paneer Rice Bowl (600 ml)","description":"Paneer in a tangy chilli sauce, served with rice.","original":210,"price":169,"veg":true},{"id":3,"category":"Chinese Rice Bowls","name":"Schezwan Paneer Rice Bowl (600 ml)","description":"Paneer tossed in fiery Schezwan sauce with rice.","original":210,"price":169,"veg":true},{"id":4,"category":"Chinese Rice Bowls","name":"Korean Chilli Paneer Rice Bowl (600 ml)","description":"Paneer in a sweet and spicy Korean-style chilli sauce with rice.","original":212,"price":169,"veg":true},{"id":5,"category":"Chinese Rice Bowls","name":"Chilli Chicken Rice Bowl (600 ml)","description":"Chicken tossed in spicy chilli sauce, served with rice.","original":210,"price":169,"veg":false},{"id":6,"category":"Chinese Rice Bowls","name":"Chicken Manchurian Rice Bowl (600 ml)","description":"Chicken in a tangy Manchurian sauce, served with rice.","original":210,"price":169,"veg":false},{"id":7,"category":"Chinese Rice Bowls","name":"Schezwan Chicken Rice Bowl (600 ml)","description":"Chicken in fiery Schezwan sauce with rice.","original":212,"price":169,"veg":false},{"id":8,"category":"Chinese Rice Bowls","name":"Hot Garlic Chicken Rice Bowl (600 ml)","description":"Chicken in a spicy garlic sauce, served with rice.","original":212,"price":169,"veg":false},{"id":9,"category":"Chinese Rice Bowls","name":"Korean Chilli Chicken Rice Bowl (600 ml)","description":"Chicken in a sweet and spicy Korean-style chilli sauce with rice.","original":212,"price":169,"veg":false},{"id":10,"category":"Indian Rice Bowls","name":"Dal Tadka Rice Bowl (600 ml)","description":"Tempered yellow dal served with rice.","original":180,"price":149,"veg":true},{"id":11,"category":"Indian Rice Bowls","name":"Paneer Butter Masala Rice Bowl (600 ml)","description":"Paneer in a rich buttery tomato gravy with rice.","original":210,"price":169,"veg":true},{"id":12,"category":"Indian Rice Bowls","name":"Kadai Paneer Rice Bowl (600 ml)","description":"Paneer cooked with peppers and kadai spices, served with rice.","original":210,"price":169,"veg":true},{"id":13,"category":"Indian Rice Bowls","name":"Paneer Do Pyaza Rice Bowl (600 ml)","description":"Paneer in a flavourful onion-based gravy with rice.","original":198,"price":159,"veg":true},{"id":14,"category":"Indian Rice Bowls","name":"Egg Curry Rice Bowl (600 ml)","description":"Eggs simmered in a spiced Indian gravy with rice.","original":174,"price":139,"veg":false},{"id":15,"category":"Indian Rice Bowls","name":"Chicken Curry Rice Bowl (600 ml)","description":"Homestyle spiced chicken curry served with rice.","original":210,"price":169,"veg":false},{"id":16,"category":"Indian Rice Bowls","name":"Butter Chicken Rice Bowl (600 ml)","description":"Chicken in a creamy buttery tomato gravy with rice.","original":212,"price":169,"veg":false},{"id":17,"category":"Indian Rice Bowls","name":"Kadai Chicken Rice Bowl (600 ml)","description":"Chicken cooked with peppers and kadai spices, served with rice.","original":212,"price":169,"veg":false},{"id":18,"category":"Indian Rice Bowls","name":"Chicken Do Pyaza Rice Bowl (600 ml)","description":"Chicken in a flavourful onion-based gravy with rice.","original":212,"price":169,"veg":false},{"id":19,"category":"Indian Rice Bowls","name":"Chicken Masala Rice Bowl (600 ml)","description":"Chicken cooked in a rich masala gravy, served with rice.","original":212,"price":169,"veg":false},{"id":20,"category":"Paratha & Tawa Roti Combos","name":"2 Aloo Paratha + Curd & Pickle","description":"Two potato-stuffed parathas served with curd and pickle.","original":175,"price":139,"veg":true},{"id":21,"category":"Paratha & Tawa Roti Combos","name":"2 Paneer Paratha + Curd & Pickle","description":"Two paneer-stuffed parathas served with curd and pickle.","original":200,"price":159,"veg":true},{"id":22,"category":"Paratha & Tawa Roti Combos","name":"2 Butter Paratha + Dal Tadka","description":"Two buttered parathas served with tempered dal.","original":180,"price":149,"veg":true},{"id":23,"category":"Paratha & Tawa Roti Combos","name":"2 Plain Paratha + Paneer Butter Masala","description":"Two plain parathas with creamy paneer butter masala.","original":210,"price":169,"veg":true},{"id":24,"category":"Paratha & Tawa Roti Combos","name":"2 Plain Paratha + Kadai Paneer","description":"Two plain parathas served with spiced kadai paneer.","original":210,"price":169,"veg":true},{"id":25,"category":"Paratha & Tawa Roti Combos","name":"2 Plain Paratha + Egg Curry","description":"Two plain parathas served with spiced egg curry.","original":174,"price":139,"veg":false},{"id":26,"category":"Paratha & Tawa Roti Combos","name":"2 Plain Paratha + Chilli Chicken","description":"Two plain parathas paired with spicy chilli chicken.","original":212,"price":169,"veg":false},{"id":27,"category":"Paratha & Tawa Roti Combos","name":"2 Plain Paratha + Butter Chicken","description":"Two plain parathas served with creamy butter chicken.","original":202,"price":159,"veg":false},{"id":28,"category":"Paratha & Tawa Roti Combos","name":"3 Tawa Roti + Dal Tadka","description":"Three tawa rotis served with tempered dal.","original":169,"price":139,"veg":true},{"id":29,"category":"Paratha & Tawa Roti Combos","name":"3 Tawa Roti + Chicken Curry","description":"Three tawa rotis served with homestyle chicken curry.","original":198,"price":159,"veg":false},{"id":30,"category":"Paratha & Tawa Roti Combos","name":"3 Tawa Roti + Paneer Butter Masala","description":"Three tawa rotis served with creamy paneer butter masala.","original":198,"price":159,"veg":true},{"id":31,"category":"Momo Station","name":"Veg Steamed Momos (6 pcs)","description":"Soft steamed dumplings filled with vegetables.","original":90,"price":69,"veg":true},{"id":32,"category":"Momo Station","name":"Chicken Steamed Momos (6 pcs)","description":"Soft steamed dumplings with a seasoned chicken filling.","original":100,"price":79,"veg":false},{"id":33,"category":"Momo Station","name":"Veg Fried Momos (6 pcs)","description":"Golden fried dumplings with a vegetable filling.","original":100,"price":79,"veg":true},{"id":34,"category":"Momo Station","name":"Chicken Fried Momos (6 pcs)","description":"Golden fried dumplings with a chicken filling.","original":110,"price":89,"veg":false},{"id":35,"category":"Momo Station","name":"Veg Kurkure Momos (6 pcs)","description":"Vegetable momos with a crunchy coating.","original":129,"price":99,"veg":true},{"id":36,"category":"Momo Station","name":"Chicken Kurkure Momos (6 pcs)","description":"Chicken momos with a crispy, crunchy coating.","original":139,"price":109,"veg":false},{"id":37,"category":"Momo Station","name":"Veg Schezwan Pan-Tossed Momos (6 pcs)","description":"Vegetable momos pan-tossed in fiery Schezwan sauce.","original":169,"price":139,"veg":true},{"id":38,"category":"Momo Station","name":"Chicken Schezwan Pan-Tossed Momos (6 pcs)","description":"Chicken momos pan-tossed in fiery Schezwan sauce.","original":179,"price":139,"veg":false},{"id":39,"category":"Momo Station","name":"Veg Chilli Pan-Tossed Momos (6 pcs)","description":"Vegetable momos pan-tossed in spicy chilli sauce.","original":169,"price":139,"veg":true},{"id":40,"category":"Momo Station","name":"Chicken Chilli Pan-Tossed Momos (6 pcs)","description":"Chicken momos pan-tossed in spicy chilli sauce.","original":179,"price":139,"veg":false},{"id":41,"category":"Chinese Starters - Veg","name":"Chilli Mushroom Dry","description":"Crispy mushrooms tossed with chilli, peppers and garlic.","original":186,"price":149,"veg":true},{"id":42,"category":"Chinese Starters - Veg","name":"Chilli Paneer Dry","description":"Paneer tossed with peppers and a tangy chilli sauce.","original":200,"price":159,"veg":true},{"id":43,"category":"Chinese Starters - Veg","name":"Chilli Baby Corn Dry","description":"Crispy baby corn tossed in spicy chilli sauce.","original":186,"price":149,"veg":true},{"id":44,"category":"Chinese Starters - Veg","name":"Schezwan Baby Corn","description":"Crispy baby corn pan-tossed in fiery Schezwan sauce.","original":198,"price":159,"veg":true},{"id":45,"category":"Chinese Starters - Veg","name":"Hot Garlic Mushroom","description":"Mushrooms tossed in a bold hot garlic sauce.","original":198,"price":159,"veg":true},{"id":46,"category":"Chinese Starters - Non-Veg","name":"Chilli Chicken Dry","description":"Chicken tossed with peppers and chilli sauce.","original":210,"price":169,"veg":false},{"id":47,"category":"Chinese Starters - Non-Veg","name":"Chicken Lollipop Dry (4 pcs)","description":"4 pcs of crispy, seasoned chicken lollipops.","original":159,"price":129,"veg":false},{"id":48,"category":"Chinese Starters - Non-Veg","name":"Saucy Chicken Lollipop (4 pcs)","description":"4 pcs of chicken lollipops with a distinctive sauce style flavour.","original":179,"price":139,"veg":false},{"id":49,"category":"Chinese Starters - Non-Veg","name":"Schezwan Chicken Lollipop (4 pcs)","description":"4 pcs of chicken lollipops tossed in spicy Schezwan sauce.","original":179,"price":139,"veg":false},{"id":50,"category":"Chinese Starters - Non-Veg","name":"Korean Chilli Wings (4 pcs)","description":"4 pcs of chicken wings coated in a sweet-spicy Korean-style sauce.","original":159,"price":129,"veg":false},{"id":51,"category":"Chinese Starters - Non-Veg","name":"BBQ Chicken Wings (4 pcs)","description":"4 pcs of chicken wings glazed with smoky barbecue sauce.","original":159,"price":129,"veg":false},{"id":52,"category":"Snack Combos - Veg","name":"4 Veg Steamed Momos + Classic Maggi","description":"Four steamed vegetable momos paired with classic masala Maggi.","original":220,"price":179,"veg":true},{"id":53,"category":"Snack Combos - Veg","name":"4 Veg Fried Momos + Cheesy Maggi","description":"Four crispy fried vegetable momos paired with cheesy Maggi.","original":240,"price":189,"veg":true},{"id":54,"category":"Snack Combos - Non-Veg","name":"4 Chicken Steamed Momos + 4 BBQ Wings","description":"Four steamed chicken momos and four barbecue wings.","original":240,"price":189,"veg":false},{"id":55,"category":"Snack Combos - Non-Veg","name":"4 Chicken Lollipops + 4 Korean Chilli Wings","description":"Four chicken lollipops and four Korean chilli wings.","original":270,"price":219,"veg":false},{"id":56,"category":"Maggi Station","name":"Classic Maggi","description":"Classic masala Maggi noodles.","original":100,"price":79,"veg":true},{"id":57,"category":"Maggi Station","name":"Cheesy Maggi","description":"Masala Maggi noodles with a creamy cheese twist.","original":126,"price":99,"veg":true},{"id":58,"category":"Maggi Station","name":"Egg Maggi","description":"Masala Maggi noodles with egg.","original":146,"price":119,"veg":false},{"id":59,"category":"Maggi Station","name":"Ramen-Style Maggi","description":"Maggi noodles prepared in a flavourful ramen-inspired style.","original":162,"price":129,"veg":true}];
const menu = new Map(MENU.map(x => [x.id,x]));
const response = (data,status=200) => Response.json(data,{status,headers:{
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'
}});
const err = (message,status=400) => response({error:message},status);
const clean = (x,max=200) => typeof x==='string'?x.trim().slice(0,max):'';
const phone = x => /^\d{10}$/.test(x);
const base64url = x => Uint8Array.from(atob(x.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(x.length/4)*4,'=')),c=>c.charCodeAt(0));
const decode = x => JSON.parse(new TextDecoder().decode(base64url(x)));
let jwks=null, keyExpiry=0;
async function tokenUser(req,env){
  if(!env.FIREBASE_PROJECT_ID) return null;
  const bearer=req.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
  if(!bearer || bearer.length>8192) return null;
  try{
    const [h,p,s,...rest]=bearer.split('.'); if(!s||rest.length)return null;
    const header=decode(h),claims=decode(p),now=Math.floor(Date.now()/1000);
    if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.aud!==env.FIREBASE_PROJECT_ID||
      claims.iss!=='https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID||
      typeof claims.sub!=='string'||!claims.sub||claims.sub.length>128||
      !Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+60||
      !Number.isFinite(claims.auth_time)||claims.auth_time>now+60)return null;
    if(!jwks||Date.now()>keyExpiry||!jwks.keys.some(k=>k.kid===header.kid)){
      const r=await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
      if(!r.ok)return null;
      jwks=await r.json();keyExpiry=Date.now()+Math.min(3600,Number(r.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]||300))*1000;
    }
    const jwk=jwks.keys.find(k=>k.kid===header.kid);if(!jwk)return null;
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,base64url(s),new TextEncoder().encode(h+'.'+p)))return null;
    if(claims.firebase?.sign_in_provider!=='google.com') return null;
    return {uid:claims.sub,name:clean(claims.name,80),phone:clean(claims.phone_number,20).replace(/^\+91/,''),email:claims.email_verified?clean(claims.email,254):''};
  }catch{return null}
}
async function body(req){
  if(!req.headers.get('Content-Type')?.startsWith('application/json'))throw new Error('Invalid content type');
  const raw=await req.text();if(raw.length>18000)throw new Error('Request too large');return JSON.parse(raw);
}
async function admin(req,env){
  const user=await tokenUser(req,env),allowed=clean(env.MERCHANT_EMAIL,254).toLowerCase();
  return Boolean(allowed&&user?.email&&user.email.toLowerCase()===allowed);
}
async function rate(env,req,kind,max){
  if(!env.RATE_SECRET||!env.DB)return false;
  const ip=req.headers.get('CF-Connecting-IP')||'unknown';
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.RATE_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const mac=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ip));
  const hash=Array.from(new Uint8Array(mac),x=>x.toString(16).padStart(2,'0')).join('');
  const day=new Date().toISOString().slice(0,10),bucket=day+':'+kind+':'+hash;
  const row=await env.DB.prepare('INSERT INTO limits(bucket,hits) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(bucket).first();
  return Number(row?.hits)<=max;
}
function coords(x){
  const lat=x?.lat,lon=x?.lon;
  return typeof lat==='number'&&typeof lon==='number'&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?{lat,lon}:null;
}
function serviceability(env,point){
  const xy=coords(point);
  const origin=env.OUTLET_LAT!=null&&env.OUTLET_LON!=null&&String(env.OUTLET_LAT).trim()&&String(env.OUTLET_LON).trim()?coords({lat:Number(env.OUTLET_LAT),lon:Number(env.OUTLET_LON)}):null;
  const radius=Math.min(200,Number(env.DELIVERY_RADIUS_METERS||200));
  if(!origin||!Number.isFinite(radius)||radius<=0)return {available:false,configured:false};
  if(!xy)return {available:false,configured:true,requiresPin:true};
  const radians=x=>x*Math.PI/180;
  const dlat=radians(xy.lat-origin.lat),dlon=radians(xy.lon-origin.lon);
  const a=Math.sin(dlat/2)**2+Math.cos(radians(origin.lat))*Math.cos(radians(xy.lat))*Math.sin(dlon/2)**2;
  const distance=6371000*2*Math.asin(Math.sqrt(Math.min(1,a)));
  return {available:distance<=radius,configured:true,outside:distance>radius,distanceMeters:Math.round(distance)};
}
function quote(selection,catalog=menu){
  if(!Array.isArray(selection)||!selection.length||selection.length>250)return null;
  const seen=new Set(),items=[];let subtotal=0;
  for(const line of selection){
    const x=catalog.get(line.id);if(!x||x.available===false||!Number.isInteger(line.qty)||line.qty<1||line.qty>99||seen.has(x.id))return null;
    seen.add(x.id);items.push({id:x.id,name:x.name,qty:line.qty,price:x.price});subtotal+=x.price*line.qty*100;
  }
  const delivery=subtotal<15000?3000:0,gst=Math.round(subtotal*5/100),cgst=Math.floor(gst/2),sgst=gst-cgst,raw=subtotal+delivery+gst,total=Math.round(raw/100)*100;
  return {items,bill:{items:subtotal/100,packaging:0,delivery:delivery/100,gst:gst/100,cgst:cgst/100,sgst:sgst/100,roundOff:(total-raw)/100,total:total/100}};
}
// Campaigns remain empty until the merchant publishes them in Batch 2. Server owns every payable amount.
async function promotionTables(env){await env.DB.prepare('CREATE TABLE IF NOT EXISTS promotions (id TEXT PRIMARY KEY,data TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0)').run();await env.DB.prepare('CREATE TABLE IF NOT EXISTS customer_requests (id TEXT PRIMARY KEY,uid TEXT NOT NULL,order_id TEXT NOT NULL,kind TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT \'pending\',created_at TEXT DEFAULT CURRENT_TIMESTAMP)').run()}
const funnelDay=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const validVisit=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
async function funnelTable(env){await env.DB.prepare('CREATE TABLE IF NOT EXISTS funnel_daily (day TEXT NOT NULL,session TEXT NOT NULL,cart INTEGER NOT NULL DEFAULT 0,ordered INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,session))').run()}
async function funnelEvent(env,session,event){if(!validVisit(session))return;await funnelTable(env);await env.DB.prepare('INSERT INTO funnel_daily(day,session,cart,ordered) VALUES(?,?,?,?) ON CONFLICT(day,session) DO UPDATE SET cart=MAX(cart,excluded.cart),ordered=MAX(ordered,excluded.ordered)').bind(funnelDay(),session,event==='cart'||event==='order'?1:0,event==='order'?1:0).run()}
function promotionPayload(b,catalog){const name=clean(b.name,100),type=b.type,value=Number(b.value||0),minSubtotal=Number(b.minSubtotal||0),maxDiscount=Number(b.maxDiscount||0),code=clean(b.code,40).toUpperCase(),audience=b.audience||'all',category=clean(b.category,100),itemIds=Array.isArray(b.itemIds)?[...new Set(b.itemIds.map(Number))]:[],buyQty=Number(b.buyQty||1),getQty=Number(b.getQty||1),freeItemId=Number(b.freeItemId||0),startsAt=b.startsAt||null,endsAt=b.endsAt||null;if(!name||!['percentage','amount','flat','bogo','free_item'].includes(type)||![value,minSubtotal,maxDiscount].every(x=>Number.isFinite(x)&&x>=0&&x<=100000)||type==='percentage'&&(value<=0||value>100)||type==='amount'&&value<=0||!['all','first','repeat'].includes(audience)||code&&!/^[A-Z0-9_-]{2,40}$/.test(code)||category&&!catalog.some(x=>x.category===category)||itemIds.some(id=>!catalog.some(x=>x.id===id))||type==='free_item'&&!catalog.some(x=>x.id===freeItemId)||![buyQty,getQty].every(x=>Number.isInteger(x)&&x>=1&&x<=99)||[startsAt,endsAt].some(x=>x&&!Number.isFinite(Date.parse(x)))||startsAt&&endsAt&&Date.parse(startsAt)>=Date.parse(endsAt)||typeof b.enabled!=='boolean')return null;return {name,type,value,minSubtotal,maxDiscount,code,audience,category,itemIds,buyQty,getQty,freeItemId,startsAt,endsAt}}
async function activeOffers(env){await promotionTables(env);const now=Date.now(),rows=(await env.DB.prepare('SELECT id,data FROM promotions WHERE enabled=1').all()).results;return rows.flatMap(r=>{try{const v=JSON.parse(r.data);if(!['percentage','amount','flat','bogo','free_item'].includes(v.type)||!v.name)return[];if(v.startsAt&&!(Date.parse(v.startsAt)<=now)||v.endsAt&&!(Date.parse(v.endsAt)>now))return[];return [{...v,id:r.id}]}catch{return[]}})}
function promoQuote(selection,catalog,offers=[],coupon='',purchaseCount=0){
  const base=quote(selection,catalog);if(!base)return null;const subtotal=Math.round(base.bill.items*100),code=String(coupon||'').trim().toUpperCase(),candidates=[];
  for(const p of offers){const offerCode=String(p.code||'').toUpperCase();if(offerCode!==code&&(offerCode||code))continue;if(p.audience==='first'&&purchaseCount!==0||p.audience==='repeat'&&purchaseCount<1)continue;if(subtotal<Math.max(0,Number(p.minSubtotal)||0)*100)continue;
    const scoped=base.items.filter(i=>(!Array.isArray(p.itemIds)||!p.itemIds.length||p.itemIds.includes(i.id))&&(!p.category||catalog.get(i.id)?.category===p.category));if(!scoped.length)continue;
    const scopePaise=scoped.reduce((s,i)=>s+i.price*100*i.qty,0);let discount=0,gift=null,benefit=0;
    if(p.type==='percentage'&&Number(p.value)>0&&Number(p.value)<=100)discount=Math.round(scopePaise*Number(p.value)/100);
    if(p.type==='amount'&&Number(p.value)>0)discount=Math.round(Number(p.value)*100);
    if(p.type==='flat'&&Number(p.value)>=0)discount=scoped.reduce((s,i)=>s+Math.max(0,Math.round((i.price-Number(p.value))*100))*i.qty,0);
    if(p.type==='bogo'){const buy=Math.max(1,Math.min(99,Number(p.buyQty)||1)),get=Math.max(1,Math.min(99,Number(p.getQty)||1));if(!Number.isInteger(buy)||!Number.isInteger(get))continue;discount=scoped.reduce((s,i)=>s+Math.floor(i.qty/(buy+get))*get*i.price*100,0)}
    if(p.type==='free_item'){const g=catalog.get(Number(p.freeItemId));if(g?.available!==false&&g&&g.price>0){gift={id:g.id,name:g.name,qty:1,price:0,gift:true};benefit=g.price*100}}
    if(Number(p.maxDiscount)>0)discount=Math.min(discount,Math.round(Number(p.maxDiscount)*100));discount=Math.max(0,Math.min(scopePaise,discount));if(discount||gift)candidates.push({p,discount,gift,benefit:discount+benefit});
  }
  candidates.sort((a,b)=>b.benefit-a.benefit||String(a.p.id).localeCompare(String(b.p.id)));const best=candidates[0];if(!best)return code?{error:'Coupon is not valid for this cart or account.'}:base;
  const net=subtotal-best.discount,delivery=net<15000?3000:0,gst=Math.round(net*5/100),cgst=Math.floor(gst/2),raw=net+delivery+gst,pay=Math.round(raw/100)*100;
  return {items:[...base.items,...(best.gift?[best.gift]:[])],bill:{items:subtotal/100,discount:best.discount/100,netItems:net/100,offer:{id:best.p.id,name:best.p.name,code:best.p.code||'',type:best.p.type},gift:best.gift,packaging:0,delivery:delivery/100,gst:gst/100,cgst:cgst/100,sgst:(gst-cgst)/100,roundOff:(pay-raw)/100,total:pay/100}};
}
async function customerQuote(env,u,selection,coupon=''){const catalog=new Map((await liveCatalog(env)).map(x=>[x.id,x])),offers=await activeOffers(env);let purchases=0;if(offers.some(o=>o.audience==='first'||o.audience==='repeat'))purchases=Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE uid=? AND status!='cancelled'").bind(u.uid).first())?.n||0);return promoQuote(selection,catalog,offers,coupon,purchases)}
async function businessTables(env){await env.DB.prepare('CREATE TABLE IF NOT EXISTS menu_changes (id INTEGER PRIMARY KEY,data TEXT NOT NULL,available INTEGER NOT NULL DEFAULT 1)').run();await env.DB.prepare('CREATE TABLE IF NOT EXISTS menu_images (id INTEGER PRIMARY KEY,image BLOB NOT NULL)').run();await env.DB.prepare('CREATE TABLE IF NOT EXISTS outlet_settings (id INTEGER PRIMARY KEY CHECK(id=1),online INTEGER NOT NULL DEFAULT 1,schedule INTEGER NOT NULL DEFAULT 0,opens TEXT NOT NULL DEFAULT \'12:00\',closes TEXT NOT NULL DEFAULT \'02:00\')').run();await env.DB.prepare('CREATE TABLE IF NOT EXISTS order_eta (order_id TEXT PRIMARY KEY,minutes INTEGER NOT NULL,expected_at TEXT NOT NULL)').run()}
async function liveCatalog(env){await businessTables(env);const rows=(await env.DB.prepare('SELECT id,data,available FROM menu_changes ORDER BY id').all()).results;const images=new Set((await env.DB.prepare('SELECT id FROM menu_images').all()).results.map(x=>x.id));const map=new Map(MENU.map(x=>[x.id,{...x,available:true}]));for(const row of rows){const v=JSON.parse(row.data);map.set(row.id,{...v,id:row.id,available:!!row.available})}return [...map.values()].map(x=>({...x,image:images.has(x.id)?'/api/menu-image/'+x.id:null}))}
function outletOpen(s,now=new Date()){if(!s.online)return false;if(s.timeOff&&Date.parse(s.timeOff.startsAt)<=now.getTime()&&now.getTime()<Date.parse(s.timeOff.endsAt))return false;if(!s.schedule)return true;const hh=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',hourCycle:'h23'}).format(now)),mm=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',minute:'2-digit'}).format(now)),t=hh*60+mm;const mins=v=>Number(v.slice(0,2))*60+Number(v.slice(3,5)),a=mins(s.opens),b=mins(s.closes);return a===b|| (a<b?t>=a&&t<b:t>=a||t<b)}
async function timeOffTable(env){await env.DB.prepare('CREATE TABLE IF NOT EXISTS outlet_time_off (id INTEGER PRIMARY KEY CHECK(id=1),starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,reason TEXT NOT NULL)').run()}
function nextOutletOpen(s,now=new Date()){if(!s.online||outletOpen(s,now))return null;let cursor=now;for(let i=0;i<3;i++){if(s.timeOff&&Date.parse(s.timeOff.startsAt)<=cursor.getTime()&&cursor.getTime()<Date.parse(s.timeOff.endsAt))cursor=new Date(s.timeOff.endsAt);if(outletOpen(s,cursor))return cursor.toISOString();if(!s.schedule)return null;const ist=new Date(cursor.getTime()+19800000),[h,m]=s.opens.split(':').map(Number);ist.setUTCHours(h,m,0,0);let start=ist.getTime()-19800000;if(start<=cursor.getTime())start+=86400000;cursor=new Date(start)}return null}
async function outletSettings(env){await businessTables(env);await timeOffTable(env);const s=await env.DB.prepare('SELECT online,schedule,opens,closes FROM outlet_settings WHERE id=1').first()||{online:1,schedule:0,opens:'12:00',closes:'02:00'},r=await env.DB.prepare('SELECT starts_at,ends_at,reason FROM outlet_time_off WHERE id=1').first(),timeOff=r&&Date.parse(r.ends_at)>Date.now()?{startsAt:r.starts_at,endsAt:r.ends_at,reason:r.reason}:null,v={...s,timeOff},now=new Date(),paused=!!(timeOff&&Date.parse(timeOff.startsAt)<=now.getTime()&&now.getTime()<Date.parse(timeOff.endsAt)),open=outletOpen(v,now);return {...v,open,paused,reopenAt:nextOutletOpen(v,now),statusReason:!s.online?'Manually offline':paused?'Scheduled time-off':!open?'Outside operating hours':'Accepting orders'}}
function menuPayload(b){const name=clean(b.name,120),category=clean(b.category,100),description=clean(b.description,500),price=Number(b.price),original=Number(b.original);if(!name||!category||!Number.isInteger(price)||price<1||price>100000||!Number.isInteger(original)||original<price||original>100000||typeof b.veg!=='boolean')return null;return {name,category,description,price,original,veg:b.veg}}
async function customer(env,u){
  await env.DB.prepare('INSERT INTO customers(uid,name,phone,email) VALUES(?,?,?,?) ON CONFLICT(uid) DO NOTHING').bind(u.uid,u.name,u.phone,u.email).run();
}
async function feedbackTables(env){
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS delivery_interest (uid TEXT NOT NULL,address TEXT NOT NULL,name TEXT NOT NULL,phone TEXT NOT NULL,pg TEXT,lat REAL NOT NULL,lon REAL NOT NULL,distance INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(uid,address))').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS order_ratings (order_id TEXT PRIMARY KEY,uid TEXT NOT NULL,rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 10),created_at TEXT DEFAULT CURRENT_TIMESTAMP)').run();
}
const ORDER_TRANSITIONS={requested:['confirmed','cancelled'],confirmed:['preparing','cancelled'],preparing:['ready','out_for_delivery','cancelled'],ready:['out_for_delivery','cancelled'],out_for_delivery:['delivered'],delivered:[],cancelled:[]};
function canTransition(from,to){return from===to||Boolean(ORDER_TRANSITIONS[from]?.includes(to));}
function whatsappConfig(env){const phoneId=clean(env.WHATSAPP_PHONE_NUMBER_ID,40),token=clean(env.WHATSAPP_ACCESS_TOKEN,4000),recipient=clean(env.WHATSAPP_MERCHANT_RECIPIENT,20),template=clean(env.WHATSAPP_ORDER_TEMPLATE,100),version=clean(env.WHATSAPP_GRAPH_VERSION,20)||'v27.0';return /^\d+$/.test(phoneId)&&token&&/^\d{10,15}$/.test(recipient)&&/^[a-z0-9_]+$/.test(template)&&/^v\d+\.\d+$/.test(version)?{phoneId,token,recipient,template,version}:null;}
async function notificationTable(env){await env.DB.prepare('CREATE TABLE IF NOT EXISTS merchant_notifications (order_id TEXT PRIMARY KEY,state TEXT NOT NULL,provider_id TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)').run()}
async function notifyMerchant(env,id,total){
  const cfg=whatsappConfig(env);if(!cfg)return 'not_configured';
  await notificationTable(env);
  const claim=await env.DB.prepare("INSERT INTO merchant_notifications(order_id,state) VALUES(?,'sending') ON CONFLICT(order_id) DO NOTHING").bind(id).run();if(!claim.meta.changes)return 'already_attempted';
  let state='failed',providerId=null;
  try{const r=await fetch('https://graph.facebook.com/'+cfg.version+'/'+cfg.phoneId+'/messages',{method:'POST',headers:{Authorization:'Bearer '+cfg.token,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:cfg.recipient,type:'template',template:{name:cfg.template,language:{code:'en'},components:[{type:'body',parameters:[{type:'text',text:id},{type:'text',text:'₹'+total}]}]}}),signal:AbortSignal.timeout(8000)});const data=await r.json();if(r.ok&&data.messages?.[0]?.id){state='accepted';providerId=clean(data.messages[0].id,200)}}catch{}
  await env.DB.prepare('UPDATE merchant_notifications SET state=?,provider_id=?,updated_at=CURRENT_TIMESTAMP WHERE order_id=?').bind(state,providerId,id).run();return state;
}
async function handle(req,env){
  const url=new URL(req.url),p=url.pathname,m=req.method;
  if(!p.startsWith('/api/')){
    if(p.startsWith('/_worker.js')||p.startsWith('/schema.sql'))return new Response('Not found',{status:404});
    return env.ASSETS.fetch(req);
  }
  if(m!=='GET'&&req.headers.get('Origin')!==url.origin)return err('Origin not allowed',403);
  if(p==='/api/config'&&m==='GET'){
    let firebase=null;try{firebase=JSON.parse(env.FIREBASE_WEB_CONFIG||'null')}catch{}
    return response({firebase:env.DB&&env.FIREBASE_PROJECT_ID&&firebase?.projectId===env.FIREBASE_PROJECT_ID?firebase:null,geocoding:Boolean(env.DB&&env.GEOAPIFY_KEY&&env.RATE_SECRET)});
  }
  if(p==='/api/serviceability'&&m==='POST'){
    return response(serviceability(env,await body(req)));
  }
  if(!env.DB)return err('Service not configured',503);
  if(p==='/api/funnel'&&m==='POST'){const b=await body(req);if(!validVisit(b.session)||!['visit','cart'].includes(b.event))return err('Invalid event');if(!await rate(env,req,'funnel',300))return err('Too many events',429);await funnelEvent(env,b.session,b.event);return response({ok:true})}
  if(p==='/api/menu'&&m==='GET'){const o=await outletSettings(env);return response({items:await liveCatalog(env),outlet:{online:o.online,schedule:o.schedule,opens:o.opens,closes:o.closes,open:o.open,reopenAt:o.reopenAt}})}
  if(p==='/api/outlet'&&m==='GET'){const o=await outletSettings(env);return response({online:o.online,schedule:o.schedule,opens:o.opens,closes:o.closes,open:o.open,reopenAt:o.reopenAt})}
  if(p==='/api/offers'&&m==='GET'){const offers=await activeOffers(env);return response({offers:offers.map(o=>({id:o.id,name:o.name,type:o.type,value:o.value,minSubtotal:o.minSubtotal||0,code:o.code||'',audience:o.audience||'all',category:o.category||'',itemIds:o.itemIds||[],buyQty:o.buyQty||1,getQty:o.getQty||1,freeItemId:o.freeItemId||null,endsAt:o.endsAt||null}))})}
  if(/^\/api\/menu-image\/\d+$/.test(p)&&m==='GET'){await businessTables(env);const row=await env.DB.prepare('SELECT image FROM menu_images WHERE id=?').bind(Number(p.split('/').pop())).first();if(!row)return err('Image not found',404);return new Response(new Uint8Array(row.image),{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}})}
  if(p==='/api/address-search'&&m==='POST'){
    if(!env.GEOAPIFY_KEY||!env.RATE_SECRET)return err('Address search unavailable',503);
    if(!await rate(env,req,'address',15))return err('Too many address searches',429);
    const globalDay=new Date().toISOString().slice(0,10)+':geo:global';const global=await env.DB.prepare('INSERT INTO limits(bucket,hits) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(globalDay).first();if(Number(global?.hits)>1500)return err('Daily address lookup limit reached; use your precise GPS location',429);
    const b=await body(req),address=clean(b.address,400);if(address.length<8)return err('Enter a complete building or PG address');
    const q=new URL('https://api.geoapify.com/v1/geocode/search');q.searchParams.set('text',address);q.searchParams.set('filter','countrycode:in');q.searchParams.set('format','json');q.searchParams.set('limit','5');q.searchParams.set('apiKey',env.GEOAPIFY_KEY);
    const r=await fetch(q);if(!r.ok)return err('Address search unavailable',502);
    const results=(await r.json()).results||[];return response({results:results.filter(x=>['building','amenity'].includes(x.result_type)&&coords(x)&&x.rank?.confidence>=0.65).map(x=>({lat:x.lat,lon:x.lon,address:clean(x.formatted,500),type:x.result_type}))});
  }
  if(p==='/api/location'&&m==='POST'){
    if(!env.GEOAPIFY_KEY||!env.RATE_SECRET)return err('Address lookup not configured',503);
    if(!await rate(env,req,'geo',20))return err('Too many location requests',429);
    const globalDay=new Date().toISOString().slice(0,10)+':geo:global';
    const global=await env.DB.prepare('INSERT INTO limits(bucket,hits) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits').bind(globalDay).first();
    if(Number(global?.hits)>1500)return err('Daily address lookup limit reached; enter address manually',429);
    const xy=coords(await body(req));if(!xy)return err('Invalid coordinates');
    const q=new URL('https://api.geoapify.com/v1/geocode/reverse');
    q.searchParams.set('lat',xy.lat);q.searchParams.set('lon',xy.lon);q.searchParams.set('apiKey',env.GEOAPIFY_KEY);q.searchParams.set('limit','1');
    const r=await fetch(q);if(!r.ok)return err('Address lookup failed',502);
    const f=(await r.json()).features?.[0]?.properties;
    if(!f?.formatted)return err('Address not found',404);
    return response({address:clean(f.formatted,500),area:clean(f.suburb||f.district||f.city||f.county,80),city:clean(f.city||f.county,80),postcode:clean(f.postcode,12),state:clean(f.state,80)});
  }
  if(p.startsWith('/api/merchant/')){
    if(!await admin(req,env))return err('Merchant authentication required',401);
    if(p==='/api/merchant/funnel'&&m==='GET'){await funnelTable(env);return response({days:(await env.DB.prepare('SELECT day,COUNT(*) AS visits,SUM(cart) AS carts,SUM(ordered) AS converted FROM funnel_daily WHERE day>=date(\'now\',\'-400 days\') GROUP BY day ORDER BY day').all()).results})}
    if(p==='/api/merchant/push'&&m==='GET')return response({configured:pushConfigured(env),publicKey:env.PUSH_PUBLIC_KEY||null});
    if(p==='/api/merchant/push-test'&&m==='POST'){const u=await tokenUser(req,env);if(!pushConfigured(env))return err('Push configuration unavailable',503);if(!await rate(env,req,'push-test',15))return err('Wait before retrying the notification test',429);return response(await pushEvent(env,'merchant',u.uid,{title:'KhaoKhao test notification',body:'Your merchant notification test was sent.'}))}
    if(p==='/api/merchant/push'&&m==='POST'){const u=await tokenUser(req,env),b=await body(req);return await subscription(env,u.uid,'merchant',b.subscription||{},b.remove===true)?response({ok:true}):err('Push configuration or subscription unavailable')}
    if(p==='/api/merchant/promotions'&&m==='GET'){await promotionTables(env);const rows=(await env.DB.prepare('SELECT id,data,enabled FROM promotions').all()).results;return response({promotions:rows.map(r=>({...JSON.parse(r.data),id:r.id,enabled:!!r.enabled}))})}
    if(p==='/api/merchant/promotions'&&m==='POST'){await promotionTables(env);const b=await body(req),v=promotionPayload(b,await liveCatalog(env));if(!v)return err('Review offer details and dates.');const id=b.id?clean(b.id,64):crypto.randomUUID(),old=await env.DB.prepare('SELECT id FROM promotions WHERE id=?').bind(id).first();if(b.id&&!old)return err('Campaign not found',404);const n=await env.DB.prepare('SELECT COUNT(*) AS n FROM promotions').first();if(!old&&Number(n?.n)>=100)return err('Campaign limit reached');await env.DB.prepare('INSERT INTO promotions(id,data,enabled) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,enabled=excluded.enabled').bind(id,JSON.stringify(v),b.enabled?1:0).run();return response({ok:true,id})}
    if(p==='/api/merchant/requests'&&m==='GET'){await promotionTables(env);return response({requests:(await env.DB.prepare('SELECT r.id,r.order_id,r.kind,r.message,r.status,r.created_at,o.name,o.phone,o.status AS order_status FROM customer_requests r JOIN orders o ON o.id=r.order_id ORDER BY r.created_at DESC LIMIT 500').all()).results})}
    if(p==='/api/merchant/requests'&&m==='POST'){await promotionTables(env);const b=await body(req);if(!['resolved','declined','pending'].includes(b.status))return err('Invalid request status');const r=await env.DB.prepare('UPDATE customer_requests SET status=? WHERE id=?').bind(b.status,clean(b.id,64)).run();return r.meta.changes?response({ok:true}):err('Request not found',404)}
    if(p==='/api/merchant/menu'&&m==='GET')return response({items:await liveCatalog(env),outlet:await outletSettings(env)});
    if(p==='/api/merchant/menu'&&m==='POST'){const b=await body(req),v=menuPayload(b);if(!v)return err('Enter item name, category and valid integer prices.');const catalog=await liveCatalog(env);let id=Number(b.id);if(b.id){if(!catalog.some(x=>x.id===id))return err('Item not found',404);const avail=catalog.find(x=>x.id===id).available;await env.DB.prepare('INSERT INTO menu_changes(id,data,available) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(id,JSON.stringify(v),avail?1:0).run()}else{if(catalog.length>=250)return err('Menu item limit reached');const row=await env.DB.prepare('INSERT INTO menu_changes(id,data,available) SELECT MAX(999,COALESCE(MAX(id),0))+1,?,1 FROM menu_changes RETURNING id').bind(JSON.stringify(v)).first();id=row.id}return response({ok:true,id})}
    if(p==='/api/merchant/inventory'&&m==='POST'){const b=await body(req),items=(await liveCatalog(env)).filter(x=>b.category?x.category===b.category:x.id===Number(b.id));if(!items.length||typeof b.available!=='boolean')return err('Invalid inventory selection');for(const x of items){const {id,available,image,...v}=x;await env.DB.prepare('INSERT INTO menu_changes(id,data,available) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET available=excluded.available').bind(id,JSON.stringify(v),b.available?1:0).run()}return response({ok:true})}
    if(/^\/api\/merchant\/menu-image\/\d+$/.test(p)&&m==='POST'){const id=Number(p.split('/').pop());if(!(await liveCatalog(env)).some(x=>x.id===id))return err('Item not found',404);if(req.headers.get('Content-Type')!=='image/jpeg')return err('Upload a JPEG image');const buf=await req.arrayBuffer(),bytes=new Uint8Array(buf);if(bytes.length<4||bytes.length>200000||bytes[0]!==255||bytes[1]!==216)return err('Image must be a JPEG under 200 KB');await env.DB.prepare('INSERT INTO menu_images(id,image) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET image=excluded.image').bind(id,buf).run();return response({ok:true})}
    if(p==='/api/merchant/outlet'&&m==='POST'){const b=await body(req);if(typeof b.online!=='boolean'||typeof b.schedule!=='boolean'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.opens)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.closes))return err('Invalid outlet schedule');await businessTables(env);await env.DB.prepare('INSERT INTO outlet_settings(id,online,schedule,opens,closes) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET online=excluded.online,schedule=excluded.schedule,opens=excluded.opens,closes=excluded.closes').bind(b.online?1:0,b.schedule?1:0,b.opens,b.closes).run();return response({ok:true})}
    if(p==='/api/merchant/outlet'&&m==='GET')return response(await outletSettings(env));
    if(p==='/api/merchant/time-off'&&m==='POST'){const b=await body(req);await timeOffTable(env);if(b.clear===true){await env.DB.prepare('DELETE FROM outlet_time_off WHERE id=1').run();return response({ok:true})}const a=Date.parse(b.startsAt),z=Date.parse(b.endsAt),now=Date.now();if(!Number.isFinite(a)||!Number.isFinite(z)||a>=z||z<=now||a<now-300000||z-a>31*86400000)return err('Choose a valid time-off period up to 31 days.');await env.DB.prepare('INSERT INTO outlet_time_off(id,starts_at,ends_at,reason) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET starts_at=excluded.starts_at,ends_at=excluded.ends_at,reason=excluded.reason').bind(new Date(a).toISOString(),new Date(z).toISOString(),clean(b.reason,120)||'Scheduled time-off').run();return response({ok:true})}
    if(p==='/api/merchant/orders'&&m==='GET'){
      await feedbackTables(env);
      await notificationTable(env);
      await businessTables(env);const rows=await env.DB.prepare('SELECT o.id,o.name,o.phone,o.delivery,o.items,o.bill,o.total,o.method,o.utr,o.status,o.payment_status,o.created_at,r.rating,n.state AS whatsapp_state,e.minutes AS eta_minutes,e.expected_at FROM orders o LEFT JOIN order_ratings r ON r.order_id=o.id AND r.uid=o.uid LEFT JOIN merchant_notifications n ON n.order_id=o.id LEFT JOIN order_eta e ON e.order_id=o.id ORDER BY o.created_at DESC LIMIT 1000').all();
      return response({orders:rows.results,whatsappConfigured:Boolean(whatsappConfig(env))});
    }
    if(p==='/api/merchant/interests'&&m==='GET'){
      await feedbackTables(env);
      return response({interests:(await env.DB.prepare('SELECT name,phone,pg,address,lat,lon,distance,created_at FROM delivery_interest ORDER BY created_at DESC LIMIT 1000').all()).results});
    }
    if(p==='/api/merchant/status'&&m==='POST'){
      const b=await body(req),id=clean(b.id,64),old=await env.DB.prepare('SELECT status,payment_status FROM orders WHERE id=?').bind(id).first();if(!old)return err('Order not found',404);
      const next=b.status||old.status,pay=b.paymentStatus||old.payment_status;if(!canTransition(old.status,next)||!['unpaid','reported_paid','verified_paid'].includes(pay))return err('Order status changed. Refresh and try again.',409);
      if(pay==='verified_paid'&&next!=='delivered'&&old.payment_status!=='verified_paid')return err('Mark cash received after delivery.');
      if(old.payment_status==='verified_paid'&&pay!=='verified_paid')return err('Cash is already verified.',409);
      if(old.status==='requested'&&next==='confirmed'&&(!Number.isInteger(b.eta)||b.eta<5||b.eta>180))return err('Select an estimated delivery time of 5–180 minutes.');
      const updated=await env.DB.prepare('UPDATE orders SET status=?,payment_status=? WHERE id=? AND status=? AND payment_status=?').bind(next,pay,id,old.status,old.payment_status).run();if(!updated.meta.changes)return err('Order updated elsewhere. Refresh.',409);if(old.status==='requested'&&next==='confirmed'){await businessTables(env);await env.DB.prepare('INSERT INTO order_eta(order_id,minutes,expected_at) VALUES(?,?,?) ON CONFLICT(order_id) DO UPDATE SET minutes=excluded.minutes,expected_at=excluded.expected_at').bind(id,b.eta,new Date(Date.now()+b.eta*60000).toISOString()).run()}if(next!==old.status){try{const owner=await env.DB.prepare('SELECT uid FROM orders WHERE id=?').bind(id).first();await pushEvent(env,'customer',owner.uid,{title:'KhaoKhao order update',body:({confirmed:'Your order is accepted!',preparing:'Your food is being prepared.',ready:'Your order is ready.',out_for_delivery:'Your order is out for delivery.',delivered:'Delivered! Rate your Happy Bowl.',cancelled:'Your order was cancelled.'})[next]||'Check your order.'})}catch{}}return response({ok:true});
    }
    return err('Not found',404);
  }
  const u=await tokenUser(req,env);if(!u)return err('Sign in required',401);
  await customer(env,u);
  if(p==='/api/push'&&m==='GET')return response({configured:pushConfigured(env),publicKey:env.PUSH_PUBLIC_KEY||null});
  if(p==='/api/push'&&m==='POST'){const b=await body(req);return await subscription(env,u.uid,'customer',b.subscription||{},b.remove===true)?response({ok:true}):err('Push configuration or subscription unavailable')}
  if(p==='/api/customer-requests'&&m==='GET'){await promotionTables(env);return response({requests:(await env.DB.prepare('SELECT id,order_id,kind,status,created_at FROM customer_requests WHERE uid=? ORDER BY created_at DESC LIMIT 100').bind(u.uid).all()).results})}
  if(p==='/api/quote'&&m==='POST'){const b=await body(req),q=await customerQuote(env,u,b.items,clean(b.coupon,40));if(!q||q.error)return err(q?.error||'Review your cart; an item may be unavailable.',409);return response(q)}
  if(p==='/api/customer-requests'&&m==='POST'){const b=await body(req),orderId=clean(b.orderId,64),kind=clean(b.kind,20),message=clean(b.message,500);if(!['cancel','complaint'].includes(kind)||!message)return err('Select a reason and enter details.');const o=await env.DB.prepare('SELECT id,status FROM orders WHERE id=? AND uid=?').bind(orderId,u.uid).first();if(!o)return err('Order not found',404);if(kind==='cancel'&&['delivered','cancelled','out_for_delivery'].includes(o.status))return err('This order is no longer eligible for cancellation request. Contact support.');await promotionTables(env);const existing=await env.DB.prepare("SELECT id FROM customer_requests WHERE uid=? AND order_id=? AND kind=? AND status='pending'").bind(u.uid,orderId,kind).first();if(existing)return response({id:existing.id,existing:true});const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO customer_requests(id,uid,order_id,kind,message) VALUES(?,?,?,?,?)').bind(id,u.uid,orderId,kind,message).run();try{await pushEvent(env,'merchant',null,{title:kind==='cancel'?'Cancellation request':'Customer complaint',body:'Open Merchant customer support.'})}catch{}return response({id})}
  if(p==='/api/me'&&m==='GET')return response(await env.DB.prepare('SELECT name,phone,email FROM customers WHERE uid=?').bind(u.uid).first());
  if(p==='/api/me'&&m==='POST'){
    const b=await body(req),name=clean(b.name,80),number=clean(b.phone,10);if(!name||!phone(number))return err('Enter name and valid mobile number');
    await env.DB.prepare('UPDATE customers SET name=?,phone=? WHERE uid=?').bind(name,number,u.uid).run();return response({ok:true});
  }
  if(p==='/api/addresses'&&m==='GET'){
    return response({addresses:(await env.DB.prepare('SELECT id,label,address,pg,room,landmark,lat,lon FROM addresses WHERE uid=? ORDER BY updated_at DESC LIMIT 30').bind(u.uid).all()).results});
  }
  if(p==='/api/addresses'&&m==='POST'){
    const b=await body(req),id=clean(b.id,64)||crypto.randomUUID(),label=clean(b.label,20),address=clean(b.address,500),xy=coords(b);
    if(!['Home','Work','PG','Other'].includes(label)||!address||!/^[-a-zA-Z0-9]{10,64}$/.test(id))return err('Invalid address');
    const existing=await env.DB.prepare('SELECT uid FROM addresses WHERE id=?').bind(id).first();
    if(existing&&existing.uid!==u.uid)return err('Not found',404);
    const n=await env.DB.prepare('SELECT COUNT(*) AS n FROM addresses WHERE uid=?').bind(u.uid).first();
    if(!existing&&n.n>=30)return err('Address limit reached');
    await env.DB.prepare('INSERT INTO addresses(id,uid,label,address,pg,room,landmark,lat,lon) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,address=excluded.address,pg=excluded.pg,room=excluded.room,landmark=excluded.landmark,lat=excluded.lat,lon=excluded.lon,updated_at=CURRENT_TIMESTAMP WHERE uid=excluded.uid').bind(id,u.uid,label,address,clean(b.pg,100),clean(b.room,40),clean(b.landmark,150),xy?.lat??null,xy?.lon??null).run();
    return response({id});
  }
  if(p==='/api/addresses'&&m==='DELETE'){
    const b=await body(req);await env.DB.prepare('DELETE FROM addresses WHERE id=? AND uid=?').bind(clean(b.id,64),u.uid).run();return response({ok:true});
  }
  if(p==='/api/interests'&&m==='POST'){
    if(!await rate(env,req,'interest',20))return err('Too many requests. Please try again tomorrow.',429);
    const b=await body(req),xy=coords(b.gps),eligibility=serviceability(env,xy),name=clean(b.name,80),number=clean(b.phone,10),address=clean(b.address,500),pg=clean(b.pg,100);
    if(!xy||!eligibility.outside||!name||!phone(number)||!address)return err('Confirm your contact and outside-area delivery location.');
    await feedbackTables(env);
    await env.DB.prepare('INSERT INTO delivery_interest(uid,address,name,phone,pg,lat,lon,distance) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(uid,address) DO UPDATE SET name=excluded.name,phone=excluded.phone,pg=excluded.pg,lat=excluded.lat,lon=excluded.lon,distance=excluded.distance').bind(u.uid,address,name,number,pg,xy.lat,xy.lon,eligibility.distanceMeters).run();
    return response({ok:true,distanceMeters:eligibility.distanceMeters});
  }
  if(p==='/api/ratings'&&m==='POST'){
    const b=await body(req),id=clean(b.id,64),rating=b.rating;
    if(!Number.isInteger(rating)||rating<1||rating>10)return err('Choose a rating from 1 to 10.');
    await feedbackTables(env);
    const result=await env.DB.prepare("INSERT INTO order_ratings(order_id,uid,rating) SELECT id,uid,? FROM orders WHERE id=? AND uid=? AND status='delivered' ON CONFLICT(order_id) DO NOTHING").bind(rating,id,u.uid).run();
    if(!result.meta.changes)return err('Rating unavailable or already submitted.',409);
    return response({ok:true});
  }
  if(p==='/api/orders'&&m==='GET'){
    await feedbackTables(env);
    await businessTables(env);return response({orders:(await env.DB.prepare('SELECT o.id,o.items,o.bill,o.total,o.method,o.status,o.payment_status,o.created_at,r.rating,e.minutes AS eta_minutes,e.expected_at FROM orders o LEFT JOIN order_ratings r ON r.order_id=o.id AND r.uid=o.uid LEFT JOIN order_eta e ON e.order_id=o.id WHERE o.uid=? ORDER BY o.created_at DESC LIMIT 100').bind(u.uid).all()).results});
  }
  if(p==='/api/orders'&&m==='POST'){
    if(!await rate(env,req,'order',50))return err('Too many order requests',429);
    const b=await body(req),id=clean(b.id,64),existingOrder=await env.DB.prepare('SELECT uid FROM orders WHERE id=?').bind(id).first();if(existingOrder)return existingOrder.uid===u.uid?response({ok:true}):err('Order reference conflict.',409);if(!(await outletSettings(env)).open)return err('The outlet is closed. Please order when it reopens.',409);const q=await customerQuote(env,u,b.items,clean(b.coupon,40)),name=clean(b.name,80),number=clean(b.phone,10),address=clean(b.address,500);if(q?.error)return err(q.error,409);
    if(!/^TBC-[A-Z0-9-]{6,60}$/.test(id)||!q)return err('An item may be out of stock. Refresh the menu and review your cart.',409);
    if(!name||!phone(number)||!address)return err('Enter your name, 10-digit mobile number and full delivery address.');
    if(b.method!=='cod')return err('Cash on delivery is the available payment method.');
    if(b.total!==q.bill.total||String(b.offerId||'')!==String(q.bill.offer?.id||'')||(b.giftId||null)!==(q.bill.gift?.id||null))return err('Prices or offers have changed. Return to your cart and review the updated total.',409);
    const eligibility=serviceability(env,b.gps);
    if(!eligibility.available)return err(eligibility.configured?"We're not delivering to your location yet. Coming soon!":"Delivery availability is being configured. Please try again later.",422);
    const delivery={address,pg:clean(b.pg,100),room:clean(b.room,40),landmark:clean(b.landmark,150),note:clean(b.note,150),gps:coords(b.gps)};
    const inserted=await env.DB.prepare('INSERT INTO orders(id,uid,name,phone,delivery,items,bill,total,method,utr,payment_status) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,u.uid,name,number,JSON.stringify(delivery),JSON.stringify(q.items),JSON.stringify(q.bill),q.bill.total,'cod',null,'unpaid').run();
    const existing=await env.DB.prepare('SELECT uid FROM orders WHERE id=?').bind(id).first();
    if(existing?.uid!==u.uid)return err('Order reference conflict. Please try again.',409);
    if(inserted.meta.changes){try{await funnelEvent(env,b.session,'order')}catch{}try{await notifyMerchant(env,id,q.bill.total)}catch{}try{await pushEvent(env,'merchant',null,{title:'New KhaoKhao order',body:'Open Merchant to accept or reject the order.'})}catch{}}
    return response({ok:true});
  }
  return err('Not found',404);
}
export {quote,promoQuote,promotionPayload,coords,tokenUser,handle,canTransition,whatsappConfig,notifyMerchant,outletOpen,nextOutletOpen,menuPayload,liveCatalog,funnelEvent,validVisit};
export default {async fetch(req,env){try{return await handle(req,env)}catch{return err('Service temporarily unavailable',503)}}};
