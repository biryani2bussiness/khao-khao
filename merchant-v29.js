/* Approved mobile presentation. No changes to order, payment or API logic. */
(() => {
  'use strict';
  // Accept the existing Indian customer phone format and common E.164 numbers.
  function phoneTarget(value) {
    const v=String(value??'').trim();
    if(!/^[+\d\s().-]+$/.test(v)) return '';
    const n=v.replace(/[\s().-]/g,'');
    if(/^\d{10}$/.test(n)) return '+91'+n;
    if(/^91\d{10}$/.test(n)) return '+'+n;
    if(/^\+[1-9]\d{7,14}$/.test(n)) return n;
    return '';
  }
  const callIcon='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a13 13 0 0 1-7-7l2-2-2-5Z"/></svg>';
  const details=document.createElement('dialog');details.className='kk27-dialog kk29-order-dialog';details.setAttribute('aria-label','Order details');document.body.append(details);
  function openOrder(id){
    if($('dash').hidden)return;
    const o=orders.find(x=>String(x.id)===id);if(!o)return;
    const a=json(o.delivery,{}),items=json(o.items,[]),target=phoneTarget(o.phone);
    details.innerHTML='<div class="kk27-panel-head"><h2>Order details</h2><button type="button" class="secondary" aria-label="Close order details">×</button></div><p class="muted">'+esc(o.id)+' · '+esc(labels[o.status]||o.status)+'</p><section class="kk-box kk29-detail-list"><div><span>Customer</span><b>'+esc(o.name||'Customer')+'</b></div><div><span>Mobile</span><b>'+esc(target||o.phone||'Unavailable')+'</b></div><div><span>Delivery address</span><b>'+esc([a.pg,a.room,a.address,a.landmark,a.note].filter(Boolean).join(' · ')||'Not specified')+'</b></div><div><span>Payment</span><b>'+esc(String(o.method||'').toUpperCase())+'</b></div></section>'+(target?'<a class="kk29-call kk29-full-call" href="tel:'+target+'">'+callIcon+' Call customer</a>':'')+'<section class="kk-box kk29-detail-list"><h3>Order items</h3>'+items.map(x=>'<div><span>'+esc(x.qty)+' × '+esc(x.name)+'</span></div>').join('')+'<div><span>Total</span><b>'+cash(o.total)+'</b></div></section>';
    details.querySelector('.kk27-panel-head button').onclick=()=>details.close();
    if(!details.open)details.showModal();
  }
  new MutationObserver(()=>{if($('dash').hidden&&details.open)details.close()}).observe($('dash'),{attributes:true,attributeFilter:['hidden']});
  const prior=render;
  render=function(){
    prior();
    document.body.dataset.merchantView=merchantView;
    for(const row of $('rows').querySelectorAll('tr[data-id]')){
      const o=orders.find(x=>String(x.id)===row.dataset.id);
      if(!o) continue;
      const cell=row.cells[1],delivery=json(o.delivery,{}),target=phoneTarget(o.phone);
      cell.replaceChildren();
      const contact=document.createElement('div');contact.className='kk29-contact';
      const info=document.createElement('div');info.className='kk29-contact-info';
      const name=document.createElement('strong');name.textContent=o.name||'Customer';info.append(name);
      const phone=document.createElement('span');phone.className='kk29-phone';phone.textContent=target||String(o.phone||'Phone unavailable');info.append(phone);contact.append(info);
      if(target){const link=document.createElement('a');link.className='kk29-call';link.href='tel:'+target;link.setAttribute('aria-label','Call customer '+(o.name||''));link.innerHTML=callIcon+'<span>Call</span>';contact.append(link)}
      cell.append(contact);
      const address=[delivery.pg,delivery.room,delivery.address,delivery.landmark,delivery.note].filter(Boolean).join(' · ');
      if(address){const desc=document.createElement('div');desc.className='kk29-address muted';desc.textContent=address;cell.append(desc)}
      const items=row.cells[2];items.classList.add('kk29-items');
      const itemList=json(o.items,[]);const count=Array.isArray(itemList)?itemList.reduce((n,x)=>n+(Number(x.qty)||0),0):0;
      if(count){const summary=document.createElement('strong');summary.className='kk29-item-count';summary.textContent=count+' item'+(count!==1?'s':'');items.prepend(summary)}
      // Retain the real action buttons, ETA, KOT, bill and WhatsApp controls.
      const actionCell=row.cells[5],badge=actionCell.querySelector('.order-badge');
      if(badge){const head=document.createElement('div');head.className='kk29-order-status';head.textContent=badge.textContent;head.classList.add('kk29-'+String(o.status).replace(/[^a-z_]/g,''));row.cells[0].append(head)}
      const view=document.createElement('button');view.type='button';view.className='secondary kk29-detail-button';view.textContent='View order details ›';view.onclick=()=>openOrder(String(o.id));row.cells[0].append(view);
    }
  };
  window.KK29={phoneTarget};
  render();
})();
