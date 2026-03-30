/**
 * OrderTokenHud.js — Persistent Token HUD (Foundry VTT v11)
 */
const OTH="order-token-hud",TT="oth-tt-el",SLOTS=10;
const INP='style="color:#fff!important;background:rgba(0,0,0,0.6)!important;border:1px solid rgba(255,255,255,0.3)!important;font-weight:700!important;font-size:12px!important;text-align:center!important;width:36px!important;padding:1px 2px!important;border-radius:2px!important;font-family:inherit!important;-moz-appearance:textfield!important;"';
const CHARS=[
  {k:"Strength",i:"fa-solid fa-fist-raised",l:"Сила"},
  {k:"Dexterity",i:"fa-solid fa-feather",l:"Ловкость"},
  {k:"Stamina",i:"fa-solid fa-heartbeat",l:"Выносливость"},
  {k:"Accuracy",i:"fa-solid fa-crosshairs",l:"Меткость"},
  {k:"Will",i:"fa-solid fa-brain",l:"Стойкость духа"},
  {k:"Knowledge",i:"fa-solid fa-book-open",l:"Знание"},
  {k:"Charisma",i:"fa-solid fa-theater-masks",l:"Харизма"},
  {k:"Seduction",i:"fa-solid fa-heart",l:"Обольщение"},
  {k:"Leadership",i:"fa-solid fa-crown",l:"Лидерство"},
  {k:"Faith",i:"fa-solid fa-praying-hands",l:"Вера"},
  {k:"Medicine",i:"fa-solid fa-first-aid",l:"Медицина"},
  {k:"Magic",i:"fa-solid fa-hat-wizard",l:"Магия"},
  {k:"Stealth",i:"fa-solid fa-eye-slash",l:"Скрытность"}
];
const TABS=[
  {id:"weapons",i:"fa-solid fa-gavel",l:"Оружие"},
  {id:"spells",i:"fa-solid fa-star",l:"Заклинания"},
  {id:"skills",i:"fa-solid fa-scroll",l:"Навыки"},
  {id:"inventory",i:"fa-solid fa-box-open",l:"Инвентарь"},
  {id:"notes",i:"fa-solid fa-sticky-note",l:"Заметки"}
];

/* ═══ ACTION BUTTONS: Hands / Main Action / Bonus Action ═══ */
const HANDS_STATES=[
  {label:"Двуруч.",icon:"fa-solid fa-fist-raised",color:"#ffe119",tip:"Оружие в двух руках"},
  {label:"Одноруч.",icon:"fa-solid fa-hand",color:"#38b9e9",tip:"Оружие в одной руке"},
  {label:"Без оруж.",icon:"fa-regular fa-hand",color:"#999",tip:"Без оружия"}
];
const _getHands=a=>{try{return Number(a?.getFlag("Order","othHands"))||0;}catch{return 0;}};
const _setHands=async(a,v)=>{try{await a?.setFlag("Order","othHands",v);}catch{}};
const _getMainAction=a=>{try{const v=a?.getFlag("Order","othMainAction");return v===false?false:true;}catch{return true;}};
const _setMainAction=async(a,v)=>{try{await a?.setFlag("Order","othMainAction",!!v);}catch{}};
const _getBonusAction=a=>{try{const v=a?.getFlag("Order","othBonusAction");return v===false?false:true;}catch{return true;}};
const _setBonusAction=async(a,v)=>{try{await a?.setFlag("Order","othBonusAction",!!v);}catch{}};

let _a=null,_t=null,_tab=null,_dismissed=false,_syncInputsRaf=0;
const _hudActor=()=>{
  const ta=_t?.actor;
  if(ta)return ta;
  return _a||null;
};
const _s=m=>(Array.isArray(m)?m:[]).reduce((a,x)=>a+(Number(x?.value)||0),0);
const _num=v=>{const n=Number(v);return Number.isFinite(n)?Math.trunc(n):null;};
const _inpVal=inp=>{const raw=String(inp?.value??"").trim();if(!raw||raw==="-"||raw==="+")return null;if(!/^-?\d+$/.test(raw))return null;return _num(raw);};
const _hoverTok=()=>{try{return canvas?.tokens?.hover||canvas?.tokens?._hover||canvas?.tokens?.placeables?.find(t=>t?.hover)||null;}catch{return null;}};
const _resVal=(actor,res)=>{
  switch(String(res??"")){
    case "Health": return _num(actor?.system?.Health?.value)??0;
    case "Stress": return _num(actor?.system?.Stress?.value)??0;
    case "ManaFatigue": return _num(actor?.system?.ManaFatigue?.value)??0;
    default: {
      const box=actor?.system?.[res]??null;
      return _num(box?.value)??0;
    }
  }
};
const _inpActorVal=(actor,inp)=>{
  const res=String(inp?.dataset?.res??"").trim();
  if(res) return _resVal(actor,res);
  const f=String(inp?.dataset?.f??"").trim();
  return _num(foundry.utils.getProperty(actor,f))??0;
};
const _arm=a=>{let b=0;for(const i of a?.items??[]){if(i?.type!=="Armor")continue;const s=i.system??{};if(!(s.isEquiped&&s.isUsed))continue;const v=Number(s.Deffensepotential??0)||0;if(v>b)b=v;}return b+(Number(a?.system?._perkBonuses?.Armor??0)||0);};
const _e=s=>{const d=document.createElement("div");d.textContent=s??"";return d.innerHTML;};
const _ml=a=>{try{return{...(a?.getFlag("Order","tokenHudMacros")||{})};}catch{return{};}};
const _ms=async(a,sl)=>{try{await a?.setFlag("Order","tokenHudMacros",{...sl});}catch{}};

function _ttE(){let t=document.getElementById(TT);if(t)return t;t=document.createElement("div");t.id=TT;t.className="oth-tip";document.body.appendChild(t);return t;}
function _ttS(ev,h){const t=_ttE();t.innerHTML=h;t.classList.add("v");_ttM(ev);}
function _ttM(ev){const t=document.getElementById(TT);if(!t)return;let x=ev.clientX+12,y=ev.clientY-t.offsetHeight-8;if(x+t.offsetWidth>window.innerWidth-6)x=ev.clientX-t.offsetWidth-12;if(y<4)y=ev.clientY+16;t.style.left=x+"px";t.style.top=y+"px";}
function _ttH(){document.getElementById(TT)?.classList.remove("v");}

function _getHB(){
  const hb=document.getElementById("hotbar");if(!hb)return null;
  const r=hb.getBoundingClientRect();
  const col=hb.querySelector(".collapse")||hb.querySelector("[data-action='hotbar-collapse']")||hb.querySelector(".bar-controls .collapse");
  let colR=r.left+32;if(col)colR=col.getBoundingClientRect().left;
  const pg=hb.querySelector("#hotbar-page-controls")||hb.querySelector(".page-controls")||hb.querySelector(".hotbar-page");
  let pgR=r.right;if(pg)pgR=pg.getBoundingClientRect().right;
  return{l:r.left,r:r.right,t:r.top,b:r.bottom,colR,pgR,h:r.height};
}

function _build(actor){
  const sys=actor?.system??{};
  const hp=sys.Health??{},mn=sys.ManaFatigue??{},st=sys.Stress??{};
  const rank=Number(sys.Rank??0)||0,spd=Number(sys.Movement?.value??0)||0,spdM=_s(sys.Movement?.modifiers),arm=_arm(actor);
  const ms=_ml(actor);

  /* ── Action button states ── */
  const hands=_getHands(actor);
  const hs=HANDS_STATES[hands]||HANDS_STATES[0];
  const mainAct=_getMainAction(actor);
  const bonusAct=_getBonusAction(actor);

  let h=`<div id="${OTH}">`;

  // PORTRAIT
  h+=`<div class="oth-port">`;
  h+=`<div class="oth-nm">${_e(actor.name)}</div>`;
  h+=`<div class="oth-pic" data-act="sh"><img src="${actor.img||"icons/svg/mystery-man.svg"}"/>`;
  h+=`<div class="oth-ov"><div class="oth-ov-grid">`;
  h+=`<div class="oth-ob"><i class="fa-solid fa-ghost" style="color:#999;font-size:10px;"></i><input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" class="oth-inp" data-f="system.Stress.value" value="${Number(st.value??0)}" data-res="Stress" ${INP}/><span style="opacity:0.4;">/</span><b style="color:#fff;">${Number(st.max??100)}</b></div>`;
  h+=`<div class="oth-ob"><i class="fa-solid fa-heart" style="color:#ff3b3b;font-size:10px;"></i><input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" class="oth-inp" data-f="system.Health.value" value="${Number(hp.value??0)}" data-res="Health" ${INP}/><span style="opacity:0.4;">/</span><b style="color:#fff;">${Number(hp.max??0)}</b></div>`;
  h+=`<div class="oth-ob"><i class="fa-solid fa-shield-alt" style="color:rgba(238,243,255,0.6);font-size:10px;"></i><b style="color:#fff;">${arm}</b><i class="fa-solid fa-running" style="color:#38b9e9;font-size:10px;margin-left:4px;"></i><b style="color:#fff;">${spd}</b>${spdM?`<small style="font-size:8px;opacity:0.5;">(${spdM>0?"+":""}${spdM})</small>`:""}</div>`;
  h+=`<div class="oth-ob"><i class="fa-solid fa-fire" style="color:#4488dd;font-size:10px;"></i><input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" class="oth-inp" data-f="system.ManaFatigue.value" value="${Number(mn.value??0)}" data-res="ManaFatigue" ${INP}/><span style="opacity:0.4;">/</span><b style="color:#fff;">${Number(mn.max??0)}</b></div>`;
  h+=`</div></div></div></div>`;

  // UPPER
  h+=`<div class="oth-upper">`;
  h+=`<div class="oth-stats">`;

  /* ═══ THREE ACTION BUTTONS (replace old oth-rk rank+speed row) ═══ */
  h+=`<div class="oth-actions">`;
  // 1) Hands button
  h+=`<a class="oth-act-btn oth-act-hands" data-act="hands" title="${hs.tip}"><i class="${hs.icon}" style="color:${hs.color};"></i><span>${hs.label}</span></a>`;
  // 2) Main Action button
  h+=`<a class="oth-act-btn oth-act-main ${mainAct?"oth-act-on":"oth-act-off"}" data-act="mainAction" title="Основное действие"><i class="${mainAct?"fa-solid fa-check":"fa-solid fa-xmark"}"></i><span>Осн.</span></a>`;
  // 3) Bonus Action button
  h+=`<a class="oth-act-btn oth-act-bonus ${bonusAct?"oth-act-on":"oth-act-off"}" data-act="bonusAction" title="Бонусное действие"><i class="${bonusAct?"fa-solid fa-check":"fa-solid fa-xmark"}"></i><span>Бон.</span></a>`;
  h+=`</div>`;

  h+=`<div class="oth-sg">`;
  for(const c of CHARS){const cd=sys[c.k]??{},v=Number(cd.value??0)||0,m=_s(cd.modifiers);
    h+=`<div class="oth-sc" data-a="${c.k}"><i class="${c.i}"></i><b>${v}</b>`;
    if(m)h+=`<em class="${m>0?"p":"n"}">${m>0?"+":""}${m}</em>`;
    h+=`</div>`;}
  h+=`</div></div>`;

  h+=`<div class="oth-main"><div class="oth-tabs">`;
  for(const tb of TABS)h+=`<a class="oth-tb${tb.id===_tab?" on":""}" data-t="${tb.id}" data-tt="${tb.l}"><i class="${tb.i}"></i></a>`;
  h+=`</div><div class="oth-area">`;
  if(_tab)h+=_bTab(actor,_tab);
  else{h+=`<div class="oth-g5">`;for(let i=0;i<SLOTS;i++){const sl=ms[String(i)];if(sl?.img)h+=`<div class="oth-c oth-cf" data-sl="${i}"><img src="${sl.img}" draggable="true"/></div>`;else h+=`<div class="oth-c" data-sl="${i}"></div>`;}h+=`</div>`;}
  h+=`</div></div></div></div>`;
  return h;
}

function _bTab(a,id){
  const it=Array.from(a?.items??[]);
  switch(id){
    case"weapons":return _gr(it.filter(i=>["weapon","meleeweapon","rangeweapon"].includes(i.type)),"Нет оружия",i=>({used:!!(i.system??{}).inHand}));
    case"spells":{const sp=it.filter(i=>i.type==="Spell").sort((a,b)=>(Number(a.system?.Circle??999))-(Number(b.system?.Circle??999)));return _gr(sp,"Нет заклинаний",i=>({cir:Number(i.system?.Circle??i.system?.circle??0)}));}
    case"skills":{const sk=it.filter(i=>i.type==="Skill"&&!i.system?.isPerk).sort((a,b)=>(Number(a.system?.Circle??999))-(Number(b.system?.Circle??999)));const pk=it.filter(i=>i.type==="Skill"&&!!i.system?.isPerk);return _gr([...sk,...pk],"Нет навыков",i=>({cir:i.system?.isPerk?null:Number(i.system?.Circle??i.system?.circle??0),perk:!!i.system?.isPerk}));}
    case"inventory":{const inv=it.filter(i=>["weapon","meleeweapon","rangeweapon","Armor","Consumables","RegularItem"].includes(i.type));inv.sort((a,b)=>({Armor:0,meleeweapon:1,rangeweapon:2,weapon:3,Consumables:4,RegularItem:5}[a.type]??9)-({Armor:0,meleeweapon:1,rangeweapon:2,weapon:3,Consumables:4,RegularItem:5}[b.type]??9));return _gr(inv,"Инвентарь пуст",i=>{const s=i.system??{};return{used:!!(s.isEquiped||s.isUsed||s.inHand),qty:Number(s.Quantity??s.quantity??1)>1?Number(s.Quantity??s.quantity??1):null};});}
    case"notes":return`<div class="oth-empty">Заметки (в разработке)</div>`;
    default:return"";
  }
}
function _gr(items,empty,fn){
  if(!items.length)return`<div class="oth-empty">${empty}</div>`;
  let h=`<div class="oth-g5">`;
  for(const i of items){const m=fn?fn(i):{};
    h+=`<div class="oth-c oth-cf${m.used?" used":""}" data-iid="${i.id}" draggable="true"><img src="${i.img||"icons/svg/item-bag.svg"}"/>`;
    if(m.cir!=null)h+=`<span class="oth-lb oth-lc">${m.cir}</span>`;
    if(m.perk)h+=`<span class="oth-lb oth-lp">P</span>`;
    if(m.used)h+=`<span class="oth-lb oth-lu">✓</span>`;
    if(m.qty)h+=`<span class="oth-lb oth-lq">${m.qty}</span>`;
    h+=`</div>`;}
  h+=`</div>`;return h;
}

function _canView(actor){
  if(!actor)return false;
  if(game.user?.isGM)return true;
  return !!actor.isOwner;
}

function _show(a,t){_a=a;_t=t;_dismissed=false;document.getElementById(OTH)?.remove();if(!a||!_canView(a))return;const w=document.createElement("div");w.innerHTML=_build(a);const hud=w.firstElementChild;document.body.appendChild(hud);_listen(hud,a);_syncResourceInputs(a);_pos(hud);requestAnimationFrame(()=>{hud.querySelector(".oth-port")?.classList.add("v");hud.querySelector(".oth-upper")?.classList.add("v");});}
function _hide(){const h=document.getElementById(OTH);if(h){h.querySelectorAll(".v").forEach(e=>e.classList.remove("v"));setTimeout(()=>h.remove(),200);}_a=null;_t=null;_dismissed=false;_ttH();}
function _dismiss(){const h=document.getElementById(OTH);if(h){h.querySelectorAll(".v").forEach(e=>e.classList.remove("v"));setTimeout(()=>h.remove(),200);}_dismissed=true;_ttH();}
function _ref(){const a=_hudActor();if(!a){_hide();return;}_a=a;_show(a,_t);}
function _setInpDisplay(inp,val){
  const str=String(_num(val)??0);
  inp.value=str;
  inp.setAttribute("value",str);
  inp.dataset.lastCommitted=str;
}
function _syncResourceInputs(actor){
  const hud=document.getElementById(OTH);
  if(!hud||!actor)return;
  hud.querySelectorAll(".oth-inp[data-res]").forEach(inp=>{
    _setInpDisplay(inp,_resVal(actor,inp.dataset.res));
  });
}
function _scheduleResourceInputSync(actorId){
  if(_syncInputsRaf){
    try{cancelAnimationFrame(_syncInputsRaf);}catch{}
    _syncInputsRaf=0;
  }
  _syncInputsRaf=requestAnimationFrame(()=>{
    _syncInputsRaf=0;
    const fresh=(_t?.actor?.id===actorId?_t.actor:null)||(_a?.id===actorId?_a:null);
    if(!fresh)return;
    _a=fresh;
    _syncResourceInputs(fresh);
  });
}
async function _commitInp(inp,actor,{force=false}={}){
  const f=inp?.dataset?.f;
  if(!f||!actor||inp?.dataset?.committing==="1")return;
  const parsed=_inpVal(inp);
  const current=_inpActorVal(actor,inp);
  if(parsed==null){
    _setInpDisplay(inp,_num(inp?.dataset?.lastCommitted)??current);
    return;
  }
  _setInpDisplay(inp,parsed);
  if(!force&&parsed===current)return;
  inp.dataset.committing="1";
  try{
    await actor.update({[f]:parsed});
    const fresh=(_t?.actor?.id===actor.id?_t.actor:null)||actor;
    _a=fresh;
    _syncResourceInputs(fresh);
  }finally{
    inp.dataset.committing="0";
  }
}
function _maybeRestoreHud(tok){if(tok?.actor&&tok.controlled&&(!document.getElementById(OTH)||_dismissed))_show(tok.actor,tok);}

function _pos(hud){
  const m=_getHB();if(!m)return;
  const port=hud.querySelector(".oth-port");
  const upper=hud.querySelector(".oth-upper");
  if(!port||!upper)return;

  const UPPER_H=170;
  const portW=Math.max(150,m.colR);

  // Upper block: above hotbar
  const uBot=window.innerHeight-m.t+2;
  const uL=portW+2;
  const uR=Math.min(m.pgR+4,m.r+44);
  upper.style.left=uL+"px";
  upper.style.bottom=uBot+"px";
  upper.style.width=(uR-uL)+"px";
  upper.style.height=UPPER_H+"px";

  // Portrait: bottom = hotbar bottom, top = same as upper top
  const portH=m.h+2+UPPER_H;
  port.style.left="0px";
  port.style.bottom=(window.innerHeight-m.b)+"px";
  port.style.width=portW+"px";
  port.style.height=portH+"px";
}

function _listen(hud,actor){
  hud.querySelector(".oth-pic")?.addEventListener("click",e=>{if(e.target.closest(".oth-inp"))return;actor?.sheet?.render(true);});
  hud.querySelectorAll(".oth-inp").forEach(inp=>{
    _setInpDisplay(inp,_inpActorVal(actor,inp));
    inp.addEventListener("mousedown",e=>e.stopPropagation());
    inp.addEventListener("click",e=>e.stopPropagation());
    inp.addEventListener("focus",ev=>ev.target.select());
    inp.addEventListener("input",ev=>{
      const el=ev.currentTarget;
      const raw=String(el.value??"");
      const neg=raw.startsWith("-")?"-":"";
      const digits=raw.replace(/[^\d]/g,"");
      el.value=neg+digits;
    });
    inp.addEventListener("keydown",async ev=>{
      if(ev.key!=="Enter")return;
      ev.preventDefault();
      ev.stopPropagation();
      await _commitInp(ev.currentTarget,actor,{force:true});
      ev.currentTarget.blur();
    });
    inp.addEventListener("blur",ev=>{_commitInp(ev.currentTarget,actor);});
    inp.addEventListener("wheel",async ev=>{
      ev.preventDefault();
      ev.stopPropagation();
      const base=_inpVal(ev.currentTarget)??_num(ev.currentTarget.dataset.lastCommitted)??_inpActorVal(actor,ev.currentTarget)??0;
      ev.currentTarget.value=String(base+(ev.deltaY<0?1:-1));
      await _commitInp(ev.currentTarget,actor,{force:true});
    },{passive:false});
  });
  hud.querySelectorAll(".oth-sc").forEach(el=>{
    const at=el.dataset.a;
    el.addEventListener("click",ev=>{ev.preventDefault();_roll(actor,at);});
    el.addEventListener("contextmenu",ev=>{ev.preventDefault();_train(actor,at);});
    el.addEventListener("mouseenter",ev=>_sTT(ev,actor,at));
    el.addEventListener("mousemove",_ttM);el.addEventListener("mouseleave",_ttH);
  });
  hud.querySelectorAll("[data-tt]").forEach(el=>{
    el.addEventListener("mouseenter",ev=>_ttS(ev,`<span class="oth-tip-t">${_e(el.dataset.tt)}</span>`));
    el.addEventListener("mousemove",_ttM);el.addEventListener("mouseleave",_ttH);
  });
  hud.querySelectorAll(".oth-tb").forEach(btn=>{btn.addEventListener("click",ev=>{ev.preventDefault();const id=btn.dataset.t;_tab=(_tab===id)?null:id;_ref();});});

  /* ═══ ACTION BUTTONS LISTENERS ═══ */

  // Hands button: LMB = cycle forward, RMB = cycle backward
  const handsBtn=hud.querySelector('[data-act="hands"]');
  if(handsBtn){
    handsBtn.addEventListener("click",async ev=>{
      ev.preventDefault();
      const cur=_getHands(actor);
      const next=(cur+1)%3;
      await _setHands(actor,next);
      _ref();
    });
    handsBtn.addEventListener("contextmenu",async ev=>{
      ev.preventDefault();
      const cur=_getHands(actor);
      const next=(cur+2)%3; // -1 mod 3 = +2 mod 3
      await _setHands(actor,next);
      _ref();
    });
    handsBtn.addEventListener("mouseenter",ev=>{
      const cur=_getHands(actor);
      const st=HANDS_STATES[cur]||HANDS_STATES[0];
      _ttS(ev,`<div class="oth-tip-t">Занятые руки</div><div class="oth-tip-r"><span>Текущее:</span><b>${st.tip}</b></div><div class="oth-tip-h">ЛКМ — вперёд · ПКМ — назад</div>`);
    });
    handsBtn.addEventListener("mousemove",_ttM);
    handsBtn.addEventListener("mouseleave",_ttH);
  }

  // Main Action button: LMB = toggle, RMB = chat
  const mainBtn=hud.querySelector('[data-act="mainAction"]');
  if(mainBtn){
    mainBtn.addEventListener("click",async ev=>{
      ev.preventDefault();
      const cur=_getMainAction(actor);
      await _setMainAction(actor,!cur);
      _ref();
    });
    mainBtn.addEventListener("contextmenu",async ev=>{
      ev.preventDefault();
      const cur=_getMainAction(actor);
      const name=actor?.name||"Персонаж";
      const status=cur?"есть":"нет";
      await ChatMessage.create({
        speaker:ChatMessage.getSpeaker({actor}),
        content:`<p><strong>${_e(name)}</strong> — ${status} Основное действие</p>`,
        type:CONST.CHAT_MESSAGE_TYPES.OTHER
      });
    });
    mainBtn.addEventListener("mouseenter",ev=>{
      const cur=_getMainAction(actor);
      _ttS(ev,`<div class="oth-tip-t">Основное действие</div><div class="oth-tip-r"><span>Статус:</span><b style="color:${cur?"#3cb44b":"#ff3b3b"};">${cur?"Доступно":"Использовано"}</b></div><div class="oth-tip-h">ЛКМ — переключить · ПКМ — в чат</div>`);
    });
    mainBtn.addEventListener("mousemove",_ttM);
    mainBtn.addEventListener("mouseleave",_ttH);
  }

  // Bonus Action button: LMB = toggle, RMB = chat
  const bonusBtn=hud.querySelector('[data-act="bonusAction"]');
  if(bonusBtn){
    bonusBtn.addEventListener("click",async ev=>{
      ev.preventDefault();
      const cur=_getBonusAction(actor);
      await _setBonusAction(actor,!cur);
      _ref();
    });
    bonusBtn.addEventListener("contextmenu",async ev=>{
      ev.preventDefault();
      const cur=_getBonusAction(actor);
      const name=actor?.name||"Персонаж";
      const status=cur?"есть":"нет";
      await ChatMessage.create({
        speaker:ChatMessage.getSpeaker({actor}),
        content:`<p><strong>${_e(name)}</strong> — ${status} Бонусное действие</p>`,
        type:CONST.CHAT_MESSAGE_TYPES.OTHER
      });
    });
    bonusBtn.addEventListener("mouseenter",ev=>{
      const cur=_getBonusAction(actor);
      _ttS(ev,`<div class="oth-tip-t">Бонусное действие</div><div class="oth-tip-r"><span>Статус:</span><b style="color:${cur?"#3cb44b":"#ff3b3b"};">${cur?"Доступно":"Использовано"}</b></div><div class="oth-tip-h">ЛКМ — переключить · ПКМ — в чат</div>`);
    });
    bonusBtn.addEventListener("mousemove",_ttM);
    bonusBtn.addEventListener("mouseleave",_ttH);
  }

  _lIt(hud,actor);_lM(hud,actor);
  const area=hud.querySelector(".oth-area");
  if(area)area.addEventListener("wheel",ev=>{area.scrollTop+=ev.deltaY;ev.preventDefault();},{passive:false});
}
function _sTT(ev,actor,attr){
  const c=CHARS.find(x=>x.k===attr),cd=actor?.system?.[attr]??{},v=Number(cd.value??0),mods=Array.isArray(cd.modifiers)?cd.modifiers:[],t=_s(mods);
  let h=`<div class="oth-tip-t">${_e(c?.l||attr)}</div><div class="oth-tip-r"><span>Значение:</span><b>${v}</b></div><div class="oth-tip-r"><span>Мод.:</span><b>${t>=0?"+":""}${t}</b></div>`;
  if(mods.length){h+=`<hr style="border:0;border-top:1px solid rgba(255,255,255,0.08);margin:3px 0;">`;for(const m of mods)h+=`<div class="oth-tip-m"><span>${_e(m.effectName||"?")}</span><span>${m.value>=0?"+":""}${m.value}</span></div>`;}
  h+=`<div class="oth-tip-h">ЛКМ — бросок · ПКМ — тренировка</div>`;_ttS(ev,h);
}
async function _roll(a,at){const sh=a?.sheet;if(sh?._openRollDialog)return sh._openRollDialog(at);try{await a?.sheet?.render?.(true);}catch{}setTimeout(()=>a?.sheet?._openRollDialog?.(at),350);}
async function _train(a,at){const sh=a?.sheet;if(sh?._openTrainingDialog)return sh._openTrainingDialog(at);try{await a?.sheet?.render?.(true);}catch{}setTimeout(()=>a?.sheet?._openTrainingDialog?.(at),350);}
function _lIt(hud,actor){
  hud.querySelectorAll("[data-iid]").forEach(card=>{const id=card.dataset.iid;if(!id)return;
    card.addEventListener("click",ev=>{ev.preventDefault();const item=actor.items.get(id);if(!item)return;if(typeof game?.Order?.macros?.useItem==="function")game.Order.macros.useItem(item.uuid);else item.sheet?.render(true);});
    card.addEventListener("contextmenu",ev=>{ev.preventDefault();actor.items.get(id)?.sheet?.render(true);});
    card.addEventListener("dragstart",ev=>{const item=actor.items.get(id);if(!item)return;ev.dataTransfer.setData("text/plain",JSON.stringify({type:"Item",uuid:item.uuid,img:item.img,name:item.name}));});
    card.addEventListener("mouseenter",ev=>{const item=actor.items.get(id);if(!item)return;let tt=`<div class="oth-tip-t">${_e(item.name)}</div>`;const d=String(item.system?.Description||item.system?.description||"").substring(0,180);if(d)tt+=`<div style="font-size:10px;color:rgba(238,243,255,0.6);margin:3px 0;">${_e(d)}</div>`;tt+=`<div class="oth-tip-h">ЛКМ — использовать · ПКМ — лист</div>`;_ttS(ev,tt);});
    card.addEventListener("mousemove",_ttM);card.addEventListener("mouseleave",_ttH);
  });
}
function _lM(hud,actor){
  const sl=_ml(actor);
  hud.querySelectorAll("[data-sl]").forEach(el=>{const idx=el.dataset.sl;
    el.addEventListener("dragover",ev=>{ev.preventDefault();el.classList.add("dov");});
    el.addEventListener("dragleave",()=>el.classList.remove("dov"));
    el.addEventListener("drop",async ev=>{ev.preventDefault();el.classList.remove("dov");try{const d=JSON.parse(ev.dataTransfer.getData("text/plain")||"{}");if(d.type==="Item"&&d.uuid){const it=(typeof fromUuidSync==="function")?fromUuidSync(d.uuid):null;sl[idx]={uuid:d.uuid,img:it?.img||d.img||"icons/svg/d20-grey.svg",name:it?.name||d.name||"?"};await _ms(actor,sl);_ref();}}catch{}});
    el.addEventListener("click",ev=>{ev.preventDefault();const sd=sl[idx];if(!sd?.uuid)return;if(typeof game?.Order?.macros?.useItem==="function")game.Order.macros.useItem(sd.uuid);else try{fromUuidSync?.(sd.uuid)?.sheet?.render(true);}catch{}});
    el.addEventListener("contextmenu",async ev=>{ev.preventDefault();if(sl[idx]){delete sl[idx];await _ms(actor,sl);_ref();}});
  });
}

/* ═══ COMBAT: Auto-reset Main/Bonus actions on turn start ═══ */
async function _resetActionsForActor(actor){
  if(!actor)return;
  let changed=false;
  try{
    if(_getMainAction(actor)===false){await _setMainAction(actor,true);changed=true;}
    if(_getBonusAction(actor)===false){await _setBonusAction(actor,true);changed=true;}
  }catch(e){console.warn("Order | TokenHud action reset failed",e);}
  // Refresh HUD if it's currently showing this actor
  if(changed&&_a&&_a.id===actor.id&&!_dismissed){
    _ref();
  }
}

Hooks.once("ready",()=>{
  Hooks.on("controlToken",(tok,ctrl)=>{
    if(ctrl&&tok?.actor){
      _show(tok.actor,tok);
    } else {
      const c=canvas?.tokens?.controlled?.[0];
      if(c?.actor)_show(c.actor,c);
      else _hide();
    }
  });

  const _wrapTokClick=m=>{
    const orig=Token.prototype[m];
    if(typeof orig!=="function")return;
    Token.prototype[m]=function(...args){
      const res=orig.apply(this,args);
      setTimeout(()=>_maybeRestoreHud(this),0);
      return res;
    };
  };
  _wrapTokClick("_onClickLeft");
  _wrapTokClick("_onClickLeft2");
  const view=canvas?.app?.view;
  if(view){
    view.addEventListener("mouseup",()=>{
      setTimeout(()=>{
        const c=canvas?.tokens?.controlled?.[0],h=_hoverTok();
        if(c?.actor&&h?.id===c.id)_maybeRestoreHud(c);
      },0);
    },true);
  }

  Hooks.on("updateActor",o=>{
    if(!_a||_dismissed||o?.id!==_a.id)return;
    const fresh=(_t?.actor?.id===o.id?_t.actor:null)||o;
    _a=fresh;
    _scheduleResourceInputSync(o.id);
  });
  const _ri=o=>{
    if(!_a||_dismissed||!(o?.id===_a.id||o?.parent?.id===_a.id))return;
    _ref();
  };
  for(const h of["createItem","updateItem","deleteItem","createActiveEffect","updateActiveEffect","deleteActiveEffect"])Hooks.on(h,_ri);
  Hooks.on("canvasTearDown",_hide);
  window.addEventListener("resize",()=>{const h=document.getElementById(OTH);if(h)_pos(h);});
  // ESC to dismiss
  document.addEventListener("keydown",ev=>{
    if(ev.key==="Escape"&&document.getElementById(OTH)){
      ev.preventDefault();ev.stopPropagation();
      _dismiss();
    }
  },true);

  /* ═══ COMBAT HOOK: Reset Main/Bonus actions when it's this actor's turn ═══ */
  Hooks.on("updateCombat",async(combat,changed)=>{
    try{
      if(!combat?.started)return;
      // Only react to turn or round changes
      const hasTurn=Object.prototype.hasOwnProperty.call(changed??{},"turn");
      const hasRound=Object.prototype.hasOwnProperty.call(changed??{},"round");
      if(!hasTurn&&!hasRound)return;
      // Get the current combatant whose turn it now is
      const combatant=combat?.combatant;
      if(!combatant)return;
      const actor=combatant.actor??null;
      if(!actor)return;
      // Only the owner (or GM) should reset the flags to avoid race conditions
      if(!actor.isOwner&&!game.user?.isGM)return;
      await _resetActionsForActor(actor);
    }catch(e){
      console.warn("Order | TokenHud updateCombat reset failed",e);
    }
  });

  try{const c=canvas?.tokens?.controlled?.[0];if(c?.actor)_show(c.actor,c);}catch{}
});
