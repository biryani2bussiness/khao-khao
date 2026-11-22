(() => {
  'use strict';
  const $=id=>document.getElementById(id), form=$('detailsForm');
  let current=null, selected=null, busy=false, pinAddress='',checkSequence=0;
  const safelyParse=(key)=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}};
  const saved=safelyParse('kk-location-v1');
  function display(){
    const text=selected?.label?selected.label+' · '+(selected.area||selected.address.split(',')[0]):current?.area||'Select delivery location';
    $('locationTitle').textContent=text;
    $('locationFull').textContent=selected?.address||current?.address||'Choose your location or enter your address.';
  }
  function fill(a){
    const fields={address:a.address,pg:a.pg,room:a.room,landmark:a.landmark};
    for(const [k,v] of Object.entries(fields)){const el=form.elements.namedItem(k);if(el&&v!==undefined)el.value=v||''}
    pinAddress=fields.address||'';
    if(Number.isFinite(a.lat)&&Number.isFinite(a.lon))window.KhaoApp?.setGps({lat:a.lat,lon:a.lon,accuracy:a.accuracy||0});
    else window.KhaoApp?.setGps(null);
  }
  function choose(a,remember=false){selected=a;current=a;display();fill(a);if(remember)try{localStorage.setItem('kk-location-v1',JSON.stringify(a))}catch{}updateDeliveryLabel(a)}
  async function updateDeliveryLabel(a){const seq=++checkSequence,label=$('location').querySelector('small');if(!label)return;if(!Number.isFinite(a?.lat)||!Number.isFinite(a?.lon)){label.textContent='Confirm delivery location';return}label.textContent='Checking delivery…';const result=await check(a);if(seq!==checkSequence)return;label.textContent=result.available?'Free delivery ₹150+':result.outside?'Outside delivery area':'Confirm delivery location'}
  function getPosition(high=true){
    return new Promise((resolve,reject)=>{
      if(!navigator.geolocation)return reject(new Error('GPS is unavailable on this device.'));
      navigator.geolocation.getCurrentPosition(resolve,e=>reject(Object.assign(new Error(e.code===1?'Location blocked. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites; allow location and enable Precise Location. Or search your building below.':e.code===3?'GPS timed out. Search your building below.':'Location unavailable. Search your building below.'),{code:e.code})),{enableHighAccuracy:high,timeout:high?12000:10000,maximumAge:high?0:60000});
    });
  }
  async function capture(){
    if(busy)return;busy=true;$('locationStatus').textContent='Getting your location…';$('gpsStatus').textContent='Getting your location…';
    $('headerGps').disabled=true;$('captureGps').disabled=true;
    try{
      let p;try{p=await getPosition()}catch(e){if(e.code===1)throw e;p=await getPosition(false)}const xy={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy};
      if(!Number.isFinite(xy.accuracy)||xy.accuracy>100){$('locationStatus').textContent='Location is too approximate for our small delivery zone. Enable Precise Location or use the building search at checkout.';$('gpsStatus').textContent='Location is too approximate. Use Precise Location or find your exact building below.';return}
      window.KhaoApp?.setGps(xy);
      let address='',area='',postcode='';
      try{
        const r=await fetch('/api/location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:xy.lat,lon:xy.lon}),signal:AbortSignal.timeout?AbortSignal.timeout(10000):undefined});
        if(r.ok){const a=await r.json();address=a.address||'';area=[a.area,a.city].filter((s,i,v)=>s&&v.indexOf(s)===i).join(', ');postcode=a.postcode||'';if(postcode&&!address.includes(postcode))address+=', '+postcode}
      }catch{}
      if(address){choose({...xy,address,area,postcode},false);$('manualLocation').value=address;$('locationStatus').textContent='Address found. Confirm the building, room and landmark at checkout.';$('gpsStatus').textContent='GPS and address captured. Confirm your delivery details.'}
      else{current={...xy,area:'GPS pin captured',address:form.elements.namedItem('address').value.trim()};selected=null;pinAddress='';display();updateDeliveryLabel(current);$('locationStatus').textContent='GPS pin captured. Address lookup is unavailable; enter your full address including PIN code.';$('gpsStatus').textContent='GPS pin captured. Enter your complete address manually.'}
    }catch(e){$('locationStatus').textContent=e.message;$('gpsStatus').textContent=e.message}
    finally{busy=false;$('headerGps').disabled=false;$('captureGps').disabled=false}
  }
  async function check(point){
    if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lon))return {available:false,missingPin:true,message:'Confirm your building pin using GPS or the address search above.'};
    try{
      const r=await fetch('/api/serviceability',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lat:point.lat,lon:point.lon})});
      if(!r.ok)throw Error();
      const x=await r.json();
      return {available:x.available===true,outside:x.outside===true,message:x.available?'Delivery available at your location.':x.outside?'Delivery is not available in your area yet.':'Delivery availability is temporarily unavailable. Please try again later.'};
    }catch{return {available:false,message:'Unable to check delivery availability. Please try again.'}}
  }
  $('headerGps').addEventListener('click',capture);
  $('manualLocationForm').addEventListener('submit',e=>{e.preventDefault();const address=$('manualLocation').value.trim();if(!address)return;const pin=current?.area==='GPS pin captured'&&Number.isFinite(current.lat)?{lat:current.lat,lon:current.lon,accuracy:current.accuracy}:{};choose({...pin,address,area:address.split(',')[0]},true);$('locationDialog').close()});
  const finder=document.createElement('div');finder.innerHTML='<button type="button" class="text-btn full" id="findDeliveryAddress">Find my address on map</button><p class="fine" id="addressSearchStatus" role="status"></p><div id="addressMatches"></div>';const addressField=form.elements.namedItem('address');addressField.closest('label').after(finder);
  async function findAddress(){const address=addressField.value.trim(),pg=form.elements.namedItem('pg').value.trim();if(!address){$('addressSearchStatus').textContent='Enter your building and complete address first.';addressField.focus();return}const b=$('findDeliveryAddress'),matches=$('addressMatches');b.disabled=true;matches.replaceChildren();$('addressSearchStatus').textContent='Finding your building…';try{const r=await fetch('/api/address-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:[pg,address].filter(Boolean).join(', ')})});const data=await r.json();if(!r.ok)throw Error(data.error||'Address search failed');if(!data.results.length){$('addressSearchStatus').textContent='No exact building found. Try the full PG name, or allow precise GPS location.';return}$('addressSearchStatus').textContent='Select the exact building below to confirm its delivery pin.';for(const x of data.results){const btn=document.createElement('button');btn.type='button';btn.className='text-btn full';btn.textContent=x.address;btn.addEventListener('click',()=>{choose({lat:x.lat,lon:x.lon,accuracy:0,address:addressField.value,area:x.address.split(',')[0]},true);$('gpsStatus').textContent='Delivery building pin selected. Check it on Google Maps.';$('addressSearchStatus').textContent='Building pin confirmed. Continue to checkout.';matches.replaceChildren()});matches.append(btn)}}catch(e){$('addressSearchStatus').textContent=e.message||'Address search unavailable. Try GPS.'}finally{b.disabled=false}}
  $('findDeliveryAddress').addEventListener('click',findAddress);
  addressField.addEventListener('input',()=>{if(pinAddress&&addressField.value.trim()!==pinAddress.trim()){pinAddress='';if(current){delete current.lat;delete current.lon;delete current.accuracy}selected=null;window.KhaoApp?.setGps(null);++checkSequence;$('location').querySelector('small').textContent='Confirm delivery location';$('gpsStatus').textContent='Address changed. Confirm the new delivery pin.';try{localStorage.removeItem('kk-location-v1')}catch{}}$('addressMatches').replaceChildren()});
  $('confirmLocation').addEventListener('click',()=>{if(current?.address){choose(current,true);$('locationDialog').close()}else $('locationStatus').textContent='Enter the delivery address or use GPS.'});
  $('locationDialog').addEventListener('close',()=>{try{sessionStorage.setItem('kk-location-prompted','1')}catch{}});
  window.KhaoLocation={capture,check,choose,fill,findAddress,selected:()=>selected||current,removePin(){if(current){delete current.lat;delete current.lon;delete current.accuracy}if(selected){delete selected.lat;delete selected.lon;delete selected.accuracy}try{localStorage.removeItem('kk-location-v1')}catch{}},clear(){current=null;selected=null;try{localStorage.removeItem('kk-location-v1')}catch{}display()}};
  $('gpsStatus').textContent='Use your precise GPS location or find your exact building on the map below.';
  if(saved?.address){choose(saved)}else{display();try{if(!sessionStorage.getItem('kk-location-prompted'))setTimeout(()=>{if(!document.querySelector('dialog[open]'))$('locationDialog').showModal()},1200)}catch{}}
})();
