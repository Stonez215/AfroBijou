/* Afro Bijou Jewelry: shared behaviour for every page */
(function(){
const B=document.body.dataset.base||"/";
const C=(window.CATALOG||[]).map(i=>Object.assign({},i,{src:B+i.img}));
const byId=Object.fromEntries(C.map(i=>[i.id,i]));
const SHORT={gold:"Gold",silver:"Silver",brass:"Brass",copper:"Copper",beaded:"Beaded"};
const METAL={gold:"18k or 24k gold",silver:"925 sterling silver",brass:"Brass",copper:"Copper",beaded:"Natural stone, beads and shell"};
const TYPE={necklace:"necklace",pendant:"pendant",ring:"ring",bracelet:"bracelet",cuff:"cuff",earrings:"earrings",healing:"healing ankh",set:"set"};
const TYPES=[["necklace","Necklaces"],["pendant","Pendants"],["ring","Rings"],["bracelet","Bracelets"],["cuff","Cuffs and bangles"],["earrings","Earrings"],["healing","Healing ankh"],["set","Sets"]];
const METALS=[["gold","Gold"],["silver","Silver"],["brass","Brass"],["copper","Copper"],["beaded","Beaded"]];
const ORDER=TYPES.map(t=>t[0]);
const mlab=i=>i.mlabel||METAL[i.metal];
const sub=i=>`${SHORT[i.metal]} ${TYPE[i.type]}`;
const money=n=>"$"+n.toLocaleString("en-US");
const $=id=>document.getElementById(id);
const CFG={ship:10,dep:50};
fetch(B+"api/config").then(r=>r.ok?r.json():null).then(j=>{if(j){CFG.ship=j.shipping;CFG.dep=j.depositPercent;const e=$("shipPrice");if(e)e.textContent=CFG.ship>0?`${money(CFG.ship)} flat rate`:"Free";}}).catch(()=>{});
async function post(path,body){
  const isForm=body instanceof FormData;
  const r=await fetch(B+"api/"+path,{method:"POST",headers:isForm?{}:{"Content-Type":"application/json"},body:isForm?body:JSON.stringify(body)});
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok)throw new Error(j.error||"offline");return j;
}
function busy(btn,on,label){if(!btn)return;if(on){btn.dataset.l=btn.textContent;btn.textContent=label||"Sending…";btn.disabled=true}else{btn.textContent=btn.dataset.l||btn.textContent;btn.disabled=false}}

/* ---------- scoped catalog for this page ---------- */
let scope={};try{scope=JSON.parse(document.body.dataset.scope||"{}")}catch(e){}
const inScope=i=>(!scope.metal||[].concat(scope.metal).includes(i.metal))&&(!scope.type||[].concat(scope.type).includes(i.type))&&(!scope.ready||i.ready);
const pool=C.filter(inScope);
const grid=$("grid");
function card(i){return `<button class="card" type="button" data-id="${i.id}">
  <div class="ph"><img src="${i.src}" alt="${i.name}, ${mlab(i)} ${TYPE[i.type]} handmade by Papa Gueye" loading="lazy" width="600" height="600">${i.ready?'<span class="badge ready">In stock</span>':'<span class="badge">Made to order</span>'}</div>
  <span class="sub">${sub(i)}</span><span class="nm">${i.name}</span>
  <span class="pr">${i.ready?"":"From "}${money(i.price)}<small>est.</small></span></button>`}
if(grid){
  const st={metal:"all",type:"all"};
  const dims=(document.body.dataset.dims||"").split(",").filter(Boolean);
  const limit=+(document.body.dataset.limit||0);
  const fbox=$("filters");
  function row(key,label,opts){
    const r=document.createElement("div");r.className="frow";r.innerHTML=`<span class="lab">${label}</span>`;
    [["all","All"],...opts].forEach(([v,l])=>{
      const b=document.createElement("button");b.type="button";b.className="chip";b.dataset.key=key;b.dataset.val=v;b.innerHTML=`${l} <span class="n"></span>`;
      b.addEventListener("click",()=>{st[key]=v;render()});r.appendChild(b)});
    fbox.appendChild(r);
  }
  if(fbox){
    if(dims.includes("metal"))row("metal","Material",METALS.filter(([v])=>pool.some(i=>i.metal===v)));
    if(dims.includes("type"))row("type","Piece",TYPES.filter(([v])=>pool.some(i=>i.type===v)));
    const n=document.createElement("span");n.className="result-note";n.id="resultNote";(fbox.lastElementChild||fbox).appendChild(n);
  }
  function render(){
    const match=(i,k,v)=>v==="all"||i[k]===v;
    document.querySelectorAll(".chip[data-key]").forEach(c=>{
      const k=c.dataset.key,v=c.dataset.val,o=k==="metal"?"type":"metal";
      c.setAttribute("aria-pressed",String(st[k]===v));
      c.querySelector(".n").textContent=pool.filter(i=>match(i,k,v)&&match(i,o,st[o])).length;
    });
    let list=pool.filter(i=>match(i,"metal",st.metal)&&match(i,"type",st.type))
      .sort((a,b)=>(b.ready-a.ready)||(ORDER.indexOf(a.type)-ORDER.indexOf(b.type))||(C.indexOf(a)-C.indexOf(b)));
    if(limit)list=list.slice(0,limit);
    if($("resultNote"))$("resultNote").textContent=list.length+(list.length===1?" piece":" pieces");
    grid.innerHTML=list.length?list.map(card).join(""):`<div class="empty">Nothing here with those filters. Try another, or <a class="link" href="${B}custom-jewelry/${document.body.dataset.ix||""}">ask Papa to make it</a>.</div>`;
  }
  render();
}
document.addEventListener("click",e=>{const c=e.target.closest(".card[data-id]");if(c){e.preventDefault();openModal(c.dataset.id)}});

/* ---------- product modal ---------- */
const modal=$("modal"),scrim=$("scrim"),drawer=$("drawer");let cur=null,lastFocus=null;
function openModal(id){
  const i=byId[id];if(!i)return;cur=i;lastFocus=document.activeElement;
  $("mImg").src=i.src;$("mImg").alt=`${i.name}, ${mlab(i)}`;
  $("mSub").textContent=sub(i);$("mTitle").textContent=i.name;
  const known=i.metal==="gold"||i.metal==="silver";
  $("mPrice").innerHTML=`${i.ready?"":"From "}${money(i.price)}<small>${known?`Estimated at today's ${i.metal} market. `:"Estimated price. "}${i.ready?"Final price shown at checkout.":"Papa confirms the final price before he begins."}</small>`;
  $("mDesc").textContent=i.desc;
  const sib=C.find(x=>x.design===i.design&&x.metal!==i.metal);
  $("mSwap").innerHTML=sib?`Also made in <button type="button" class="chip" data-go="${sib.id}">${SHORT[sib.metal]}</button>`:(known?"Other metals by custom order":"");
  $("mSpecs").innerHTML=`<dt>${i.metal==="beaded"?"Material":"Metal"}</dt><dd>${mlab(i)}</dd><dt>Status</dt><dd>${i.ready?"In stock, ready to ship":"Made to order, about 3 days"}</dd><dt>Made</dt><dd>By hand in Miami by Papa Gueye</dd>`;
  $("mSizeWrap").hidden=!(i.type==="ring"||(i.type==="set"&&!i.ready));
  $("mActions").innerHTML=i.ready?`<button class="btn" type="button" id="addBag">Add to bag</button><button class="btn ghost" type="button" id="openInq">Ask Papa a question</button>`
    :`<button class="btn" type="button" id="openInq">Reserve this piece</button><a class="btn ghost" href="${B}custom-jewelry/${document.body.dataset.ix||""}#quote">Change the design</a>`;
  $("inqForm").classList.remove("on");$("inqDone").classList.remove("on");$("inqMsg").hidden=true;
  const dep=Math.round(i.price*CFG.dep/100);
  $("inqLead").textContent=i.ready?"Ask Papa about this piece. He'll call or text you back.":`Reserve it with a ${CFG.dep}% deposit of ${money(dep)}, paid securely through Square. Papa calls you to confirm the final price, and you pay the rest when it's ready.`;
  $("i-note-l").textContent=i.ready?"Your question":"Notes: size, engraving, timing";
  $("inqSubmit").textContent=i.ready?"Send my question":`Pay ${money(dep)} deposit with Square`;
  modal.classList.add("on");modal.setAttribute("aria-hidden","false");scrim.classList.add("on");$("closeModal").focus();
}
function closeModal(){if(!modal.classList.contains("on"))return;modal.classList.remove("on");modal.setAttribute("aria-hidden","true");if(!drawer.classList.contains("on"))scrim.classList.remove("on");if(lastFocus)lastFocus.focus()}
$("closeModal").addEventListener("click",closeModal);
modal.addEventListener("click",e=>{
  if(e.target===modal)return closeModal();
  const g=e.target.closest("[data-go]");if(g)return openModal(g.dataset.go);
  if(e.target.id==="addBag"){addToBag(cur);closeModal()}
  if(e.target.id==="openInq"){$("inqForm").classList.add("on");$("i-name").focus()}
});
$("inqForm").addEventListener("submit",async e=>{
  e.preventDefault();const n=$("i-name").value.trim(),c=$("i-contact").value.trim(),em=$("i-email").value.trim(),note=$("i-note").value.trim();
  if(!n||c.replace(/\D/g,"").length<10){toast("Add your name and a phone number so Papa can reach you");return}
  const sizeV=$("mSizeWrap").hidden?"":$("mSize").value,btn=$("inqSubmit"),msg=$("inqMsg");
  busy(btn,true,cur.ready?"Sending…":"Opening Square…");msg.hidden=true;$("inqDone").classList.remove("on");
  try{
    if(cur.ready){
      const fd=new FormData();fd.append("kind","question");fd.append("id",cur.id);fd.append("name",n);fd.append("phone",c);fd.append("email",em);fd.append("notes",note);fd.append("website",$("i-web").value);
      await post("request",fd);busy(btn,false);msg.className="notice ok";msg.textContent=`Sent. Papa will get back to you at ${c}.`;msg.hidden=false;
    }else{
      const j=await post("deposit",{id:cur.id,name:n,phone:c,email:em,notes:note,size:sizeV,website:$("i-web").value});
      location.href=j.url;
    }
  }catch(err){
    busy(btn,false);msg.className="notice";
    msg.textContent=(err.message&&err.message!=="offline"&&!/fetch/i.test(err.message)?err.message+" ":"")+`You can also text this to Papa at (305) 391-6937:`;msg.hidden=false;
    $("inqText").textContent=`Afro Bijou Jewelry, ${cur.ready?"question":"reservation"}\nPiece: ${cur.name} (${mlab(cur)})\nEst. price: ${money(cur.price)}${sizeV?"\nRing size: "+sizeV:""}\nName: ${n}\nPhone: ${c}\nNotes: ${note||"none"}`;
    $("inqDone").classList.add("on");
  }
});

/* ---------- bag ---------- */
let bag=[];try{bag=JSON.parse(localStorage.getItem("ab-bag")||"[]").filter(l=>byId[l.id])}catch(e){bag=[]}
const save=()=>{try{localStorage.setItem("ab-bag",JSON.stringify(bag))}catch(e){}};
function addToBag(i){const size=i.type==="ring"?$("mSize").value:"";const ex=bag.find(l=>l.id===i.id&&l.size===size);ex?ex.qty++:bag.push({id:i.id,size,qty:1});save();renderBag();toast(`${i.name} added to your bag`)}
function renderBag(){
  $("bagCount").textContent=bag.reduce((s,l)=>s+l.qty,0);
  $("bagBody").innerHTML=bag.length?bag.map((l,k)=>{const i=byId[l.id];return `<div class="line"><img src="${i.src}" alt="">
    <div><div class="t">${i.name}</div><div class="s">${mlab(i)}${l.size?", size "+l.size:""}</div>
    <div class="qty"><button type="button" data-q="${k}" data-d="-1" aria-label="One less">−</button><span>${l.qty}</span><button type="button" data-q="${k}" data-d="1" aria-label="One more">+</button></div></div>
    <div class="p">${money(i.price*l.qty)}<button type="button" class="rm" data-rm="${k}">Remove</button></div></div>`}).join("")
    :`<p style="color:var(--muted)">Your bag is empty. Pieces marked “In stock” can be bought online.</p>`;
  $("bagTotal").textContent=money(bag.reduce((s,l)=>s+byId[l.id].price*l.qty,0));
  $("checkoutBtn").disabled=!bag.length;
}
$("bagBody").addEventListener("click",e=>{const q=e.target.closest("[data-q]"),r=e.target.closest("[data-rm]");if(q){const l=bag[q.dataset.q];l.qty+=+q.dataset.d;if(l.qty<1)bag.splice(q.dataset.q,1)}if(r)bag.splice(r.dataset.rm,1);save();renderBag()});
function openBag(){drawer.classList.add("on");drawer.setAttribute("aria-hidden","false");scrim.classList.add("on");$("checkoutNote").hidden=true;$("closeBag").focus()}
function closeBag(){drawer.classList.remove("on");drawer.setAttribute("aria-hidden","true");if(!modal.classList.contains("on"))scrim.classList.remove("on")}
$("bagBtn").addEventListener("click",openBag);$("closeBag").addEventListener("click",closeBag);
$("checkoutBtn").addEventListener("click",async()=>{
  const btn=$("checkoutBtn"),note=$("checkoutNote"),f=(document.querySelector('input[name="ful"]:checked')||{}).value||"ship";
  busy(btn,true,"Opening Square…");note.hidden=true;
  try{const j=await post("checkout",{items:bag.map(l=>({id:l.id,size:l.size,qty:l.qty})),fulfillment:f});location.href=j.url}
  catch(err){busy(btn,false);note.textContent=(err.message&&err.message!=="offline"&&!/fetch/i.test(err.message)?err.message+" ":"Online checkout isn't available right now. ")+"To buy now, text Papa at (305) 391-6937 with the pieces in your bag. Nothing has been charged.";note.hidden=false}
});
scrim.addEventListener("click",()=>{closeModal();closeBag()});

/* ---------- mobile nav ---------- */
const mnav=$("mnav");
$("menuBtn").addEventListener("click",()=>{mnav.classList.add("on");mnav.setAttribute("aria-hidden","false");$("closeNav").focus()});
$("closeNav").addEventListener("click",()=>{mnav.classList.remove("on");mnav.setAttribute("aria-hidden","true");$("menuBtn").focus()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeModal();closeBag();mnav.classList.remove("on")}});

/* ---------- custom quote form ---------- */
const qf=$("quoteForm");
if(qf){
  $("q-file").addEventListener("change",e=>{const t=$("thumbs");t.innerHTML="";[...e.target.files].slice(0,6).forEach(f=>{const im=document.createElement("img");im.src=URL.createObjectURL(f);im.alt=f.name;t.appendChild(im)})});
  qf.addEventListener("submit",async e=>{
    e.preventDefault();const v=id=>$(id).value.trim();
    if(!v("q-name")||v("q-contact").replace(/\D/g,"").length<10){toast("Add your name and a phone number so Papa can reach you");return}
    const files=$("q-file").files.length,btn=$("quoteSubmit"),msg=$("quoteMsg");
    busy(btn,true);msg.hidden=true;$("quoteDone").classList.remove("on");
    try{const fd=new FormData(qf);fd.append("kind","custom");await post("request",fd);busy(btn,false);msg.className="field full notice ok";msg.textContent=`Sent. Papa will reach you at ${v("q-contact")}, usually within a day.`;msg.hidden=false;qf.querySelectorAll("input:not([type=radio]),textarea").forEach(x=>{if(x.type!=="file")x.value=""});$("thumbs").innerHTML="";$("q-file").value="";msg.scrollIntoView({behavior:"smooth",block:"nearest"});return}
    catch(err){busy(btn,false);msg.className="field full notice";msg.textContent=(err.message&&err.message!=="offline"&&!/fetch/i.test(err.message)?err.message+" ":"")+"You can also text this to Papa at (305) 391-6937"+(files?", with your photos":"")+":";msg.hidden=false}
    $("quoteText").textContent=`Afro Bijou Jewelry, custom quote request\nName: ${v("q-name")}\nPhone: ${v("q-contact")}\nPiece: ${qf.querySelector('input[name="piece"]:checked').value}\nMetal: ${v("q-metal")}\nBudget: ${v("q-budget")}\nSize: ${v("q-size")||"not given"}\nNeeded by: ${v("q-date")||"no date"}\nIdea: ${v("q-idea")||"not described"}${files?`\nReference photos: ${files} (attach them to your text)`:""}`;
    $("quoteDone").classList.add("on");$("quoteDone").scrollIntoView({behavior:"smooth",block:"nearest"});
  });
}
function copyFrom(id){const t=$(id).textContent;const sel=()=>{const r=document.createRange();r.selectNodeContents($(id));const s=getSelection();s.removeAllRanges();s.addRange(r);toast("Text selected. Copy it to send.")};try{navigator.clipboard.writeText(t).then(()=>toast("Copied. Paste it into a text to Papa."),sel)}catch(err){sel()}}
document.querySelectorAll("[data-copy]").forEach(b=>b.addEventListener("click",()=>copyFrom(b.dataset.copy)));
let tt;function toast(m){const t=$("toast");t.textContent=m;t.classList.add("on");clearTimeout(tt);tt=setTimeout(()=>t.classList.remove("on"),2600)}
renderBag();
})();
