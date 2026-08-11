import { getActorArmorDefenseBonus } from "./OrderArmorDefenseBuff.js";
import { getSkillCooldownView } from "./OrderSkillCooldown.js";

/* === Совместимость с Foundry VTT v13/v14 (миграция системы с v11) === */
const Token = foundry.canvas?.placeables?.Token ?? globalThis.Token;

/**
 * OrderTokenHud.js — Persistent Token HUD (Foundry VTT v11)
 */
const OTH="order-token-hud",TT="oth-tt-el",SLOTS=10;
const HOTBAR_COMPACT_CLASS="order-hotbar-sidebar-compact";
const CHARS=[
  {k:"Strength",i:"systems/Order/icons/tag-icons/characteristics/strength.svg",l:"Сила"},
  {k:"Dexterity",i:"systems/Order/icons/tag-icons/characteristics/agility.svg",l:"Ловкость"},
  {k:"Stamina",i:"systems/Order/icons/tag-icons/characteristics/endurance.svg",l:"Выносливость"},
  {k:"Accuracy",i:"systems/Order/icons/tag-icons/characteristics/accuracy.svg",l:"Меткость"},
  {k:"Will",i:"systems/Order/icons/tag-icons/characteristics/willpower.svg",l:"Стойкость духа"},
  {k:"Knowledge",i:"systems/Order/icons/tag-icons/characteristics/knowledge.svg",l:"Знание"},
  {k:"Charisma",i:"systems/Order/icons/tag-icons/characteristics/charisma.svg",l:"Харизма"},
  {k:"Seduction",i:"systems/Order/icons/tag-icons/characteristics/seduction.svg",l:"Обольщение"},
  {k:"Leadership",i:"systems/Order/icons/tag-icons/characteristics/leadership.svg",l:"Лидерство"},
  {k:"Faith",i:"systems/Order/icons/tag-icons/characteristics/faith.svg",l:"Вера"},
  {k:"Medicine",i:"systems/Order/icons/tag-icons/characteristics/medicine.svg",l:"Медицина"},
  {k:"Magic",i:"systems/Order/icons/tag-icons/characteristics/magic.svg",l:"Магия"},
  {k:"Stealth",i:"systems/Order/icons/tag-icons/characteristics/stealth.svg",l:"Скрытность"}
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

let _a=null,_t=null,_tab=null,_dismissed=false,_syncInputsRaf=0,_sidebarSyncRaf=0,_actionPopupType=null;
const _hudActor=()=>{
  const ta=_t?.actor;
  if(ta)return ta;
  return _a||null;
};
const _s=m=>(Array.isArray(m)?m:[]).reduce((a,x)=>a+(Number(x?.value)||0),0);
const _num=v=>{const n=Number(v);return Number.isFinite(n)?Math.trunc(n):null;};
const _inpExpr=inp=>{
  const raw=String(inp?.value??"").trim();
  if(!raw||raw==="-"||raw==="+")return null;
  if(!/^[+-]?\d+$/.test(raw))return null;
  const value=_num(raw);
  if(value==null)return null;
  return{value,relative:raw.startsWith("+")||raw.startsWith("-")};
};
const _inpVal=inp=>_inpExpr(inp)?.value??null;
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
const _arm=a=>{let b=0;for(const i of a?.items??[]){if(i?.type!=="Armor")continue;const s=i.system??{};if(!(s.isEquiped&&s.isUsed))continue;const v=Number(s.Deffensepotential??0)||0;if(v>b)b=v;}return b+(Number(a?.system?._perkBonuses?.Armor??0)||0)+getActorArmorDefenseBonus(a);};
const _e=s=>{const d=document.createElement("div");d.textContent=s??"";return d.innerHTML;};
const _actionCostHtml=s=>_e(String(s??"")).replace(/\s+(или)\s+/giu,'<br><span style="color:rgba(238,243,255,0.7);font-weight:400;">$1</span><br>');
const ACTION_POPUP_ID="oth-action-popup";
const _actionCost=i=>String(i?.system?.ActionCost??i?.system?.actionCost??"").replace(/\u00a0/g," ").trim();
const _actionCostMatches=(raw,type)=>{
  const s=String(raw??"").toLocaleLowerCase("ru-RU");
  if(!s)return false;
  const re=type==="main"
    ? /(^|[^а-яёa-z0-9])(?:основн[а-яё]*|осн\.?|од)(?=$|[^а-яёa-z0-9])/iu
    : /(^|[^а-яёa-z0-9])(?:бонусн[а-яё]*|бон\.?|бд)(?=$|[^а-яёa-z0-9])/iu;
  return re.test(s);
};
const _simpleActionCost=(raw,type)=>{
  let s=String(raw??"").toLocaleLowerCase("ru-RU").replace(/ё/g,"е").trim();
  s=s.replace(/[.!?;:,]+$/g,"").replace(/\s+/g," ");
  const re=type==="main"
    ? /^(?:1\s+)?(?:основн[а-я]*|осн\.?)\s*(?:действ[а-я]*)?$/iu
    : /^(?:1\s+)?(?:бонусн[а-я]*|бон\.?)\s*(?:действ[а-я]*)?$/iu;
  return re.test(s);
};
const _plainText=s=>{
  const d=document.createElement("div");
  d.innerHTML=String(s??"");
  return String(d.textContent??d.innerText??"").replace(/\s+/g," ").trim();
};
const _cut=(s,n=190)=>{const v=String(s??"");return v.length>n?`${v.slice(0,Math.max(0,n-1)).trimEnd()}…`:v;};
const _roundWord=n=>{const v=Math.abs(Number(n)||0)%100,d=v%10;return(v>10&&v<20)?"кругов":d===1?"круг":(d>=2&&d<=4)?"круга":"кругов";};
const _actionAvailable=(actor,type)=>type==="main"?_getMainAction(actor):_getBonusAction(actor);
const _actionTypeIcon=item=>item?.type==="Spell"?"fa-solid fa-hat-wizard":"fa-solid fa-bolt";
const _requiredActionCount=(raw,type)=>{
  const s=String(raw??"").toLocaleLowerCase("ru-RU");
  const re=type==="main"
    ? /(\d+)\s*(?:основн[а-яё]*|осн\.?|од)(?=$|[^а-яёa-z0-9])/iu
    : /(\d+)\s*(?:бонусн[а-яё]*|бон\.?|бд)(?=$|[^а-яёa-z0-9])/iu;
  const m=s.match(re),n=Number(m?.[1]??1);
  return Number.isFinite(n)&&n>0?Math.trunc(n):1;
};

function _actionItemStatus(actor,item,type,cost){
  if(item?.type==="Skill"){
    try{
      const cd=getSkillCooldownView({actor,skillItem:item});
      if(cd?.active){
        const rounds=Math.max(1,Number(cd.remainingRounds??0)||1);
        return{key:"cooldown",label:`${rounds} ${_roundWord(rounds)}`,icon:"fa-solid fa-hourglass-half"};
      }
    }catch(e){console.warn("Order | TokenHud cooldown status failed",e);}
  }
  if(item?.type==="Spell"){
    const usageCost=Number(item.system?.UsageCost??0)||0;
    const cur=Number(actor?.system?.ManaFatigue?.value??0)||0;
    const max=Number(actor?.system?.ManaFatigue?.max??0)||0;
    if(usageCost>0&&max>0&&cur+usageCost>max)return{key:"mana",label:"Нет маны",icon:"fa-solid fa-droplet"};
  }
  const available=_actionAvailable(actor,type)?1:0;
  const required=_requiredActionCount(cost,type);
  if(required>available){
    if(required>1)return{key:"cost",label:`Нужно ${required} действия`,icon:"fa-solid fa-layer-group"};
    return{key:"action",label:"Нет действия",icon:"fa-solid fa-circle-xmark"};
  }
  return{key:"available",label:"Доступно",icon:"fa-solid fa-bolt"};
}

function _actionPopupItems(actor,type){
  return Array.from(actor?.items??[])
    .filter(i=>i&&(i.type==="Skill"||i.type==="Spell"))
    .map(i=>({item:i,cost:_actionCost(i)}))
    .filter(x=>x.cost&&_actionCostMatches(x.cost,type))
    .sort((a,b)=>{
      const at=a.item.type==="Skill"?0:1,bt=b.item.type==="Skill"?0:1;
      if(at!==bt)return at-bt;
      const ac=Number(a.item.system?.Circle??a.item.system?.circle??999),bc=Number(b.item.system?.Circle??b.item.system?.circle??999);
      if(ac!==bc)return ac-bc;
      return String(a.item.name??"").localeCompare(String(b.item.name??""),"ru");
    });
}

function _closeActionPopup(clear=true){
  document.getElementById(ACTION_POPUP_ID)?.remove();
  if(clear)_actionPopupType=null;
}

async function _useActionPopupItem(actor,item,type){
  if(!actor||!item)return;
  _closeActionPopup(true);
  try{
    if(typeof game?.Order?.macros?.useItem==="function"){
      await game.Order.macros.useItem(item.uuid);
      if(type==="main")await _setMainAction(actor,false);
      else await _setBonusAction(actor,false);
      if(!_dismissed)_ref();
    }else{
      item.sheet?.render(true);
    }
  }catch(e){
    console.warn("Order | TokenHud action popup item use failed",e);
  }
}

function _positionActionPopup(popup,anchor){
  if(!popup||!anchor?.isConnected)return;
  const ar=anchor.getBoundingClientRect();
  const gap=10,margin=8;
  const pw=popup.offsetWidth||420,ph=popup.offsetHeight||320;
  let left=ar.left+(ar.width-pw)/2;
  left=Math.max(margin,Math.min(left,window.innerWidth-pw-margin));
  let top=ar.top-ph-gap;
  let below=false;
  if(top<margin){top=ar.bottom+gap;below=true;}
  if(top+ph>window.innerHeight-margin)top=Math.max(margin,window.innerHeight-ph-margin);
  popup.classList.toggle("oth-action-popup-below",below);
  popup.style.left=`${Math.round(left)}px`;
  popup.style.top=`${Math.round(top)}px`;
  const arrow=Math.max(18,Math.min(pw-18,ar.left+ar.width/2-left));
  popup.style.setProperty("--oth-action-arrow-x",`${Math.round(arrow)}px`);
}

function _openActionPopup(actor,type,anchor){
  if(!actor||!anchor)return;
  _closeActionPopup(false);
  _ttH();
  _actionPopupType=type;
  const popup=document.createElement("section");
  popup.id=ACTION_POPUP_ID;
  popup.className=`oth-action-popup oth-action-popup-${type}`;
  popup.dataset.actorId=actor.id??"";
  popup.dataset.actionType=type;
  const title=type==="main"?"Основные действия":"Бонусные действия";
  const countTitle=type==="main"?"Основное":"Бонусное";
  const count=_actionAvailable(actor,type)?1:0;
  const rows=_actionPopupItems(actor,type);
  let html=`<header class="oth-action-popup-head"><div class="oth-action-popup-title">${title}</div><div class="oth-action-popup-count${count?"":" oth-action-popup-count-off"}">${countTitle}: <b>${count}</b></div><button type="button" class="oth-action-popup-close" aria-label="Закрыть"><i class="fa-solid fa-xmark"></i></button></header>`;
  html+=`<div class="oth-action-popup-list">`;
  if(!rows.length){
    html+=`<div class="oth-action-popup-empty">Нет способностей или заклинаний с этой стоимостью действия.</div>`;
  }else{
    for(const {item,cost} of rows){
      const status=_actionItemStatus(actor,item,type,cost);
      const desc=_cut(_plainText(item.system?.Description??item.system?.description??""));
      const showCost=!_simpleActionCost(cost,type);
      html+=`<article class="oth-action-option" data-action-item-id="${_e(item.id)}" title="ЛКМ — использовать · ПКМ — открыть лист">`;
      html+=`<img class="oth-action-option-img" src="${_e(item.img||"icons/svg/item-bag.svg")}" alt=""/>`;
      html+=`<div class="oth-action-option-body"><div class="oth-action-option-head"><strong>${_e(item.name||"Без названия")}</strong><span class="oth-action-status oth-action-status-${status.key}">${_e(status.label)}</span></div>`;
      if(desc)html+=`<div class="oth-action-option-desc">${_e(desc)}</div>`;
      if(showCost)html+=`<div class="oth-action-option-cost"><span>Стоимость:</span><b>${_actionCostHtml(cost)}</b></div>`;
      const typeIcon=_actionTypeIcon(item);
      const typeLabel=item.type==="Spell"?"Заклинание":"Способность";
      html+=`</div><div class="oth-action-option-state oth-action-option-state-${status.key}" title="${typeLabel}"><i class="${typeIcon}"></i></div></article>`;
    }
  }
  html+=`</div>`;
  popup.innerHTML=html;
  _mountHudSurface(popup);
  popup.querySelector(".oth-action-popup-close")?.addEventListener("click",ev=>{ev.preventDefault();ev.stopPropagation();_closeActionPopup(true);});
  popup.querySelectorAll(".oth-action-option[data-action-item-id]").forEach(row=>{
    const id=row.dataset.actionItemId;
    row.addEventListener("click",async ev=>{
      ev.preventDefault();ev.stopPropagation();
      const item=actor.items?.get?.(id);if(!item)return;
      await _useActionPopupItem(actor,item,type);
    });
    row.addEventListener("contextmenu",ev=>{ev.preventDefault();ev.stopPropagation();actor.items?.get?.(id)?.sheet?.render(true);});
  });
  _positionActionPopup(popup,anchor);
}

function _toggleActionPopup(actor,type,anchor){
  const current=document.getElementById(ACTION_POPUP_ID);
  if(current&&_actionPopupType===type&&current.dataset.actorId===String(actor?.id??"")){_closeActionPopup(true);return;}
  _openActionPopup(actor,type,anchor);
}

function _refreshActionPopup(actor=_hudActor()){
  if(!_actionPopupType||!actor)return;
  const hud=document.getElementById(OTH);
  const act=_actionPopupType==="main"?"mainAction":"bonusAction";
  const anchor=hud?.querySelector?.(`[data-act="${act}"]`);
  if(anchor)_openActionPopup(actor,_actionPopupType,anchor);
  else _closeActionPopup(true);
}
const _ml=a=>{try{return{...(a?.getFlag("Order","tokenHudMacros")||{})};}catch{return{};}};
const _ms=async(a,sl)=>{try{await a?.setFlag("Order","tokenHudMacros",{...sl});}catch{}};

// Keep TokenHUD positioned against the viewport exactly as before, but place it at
// the same root stacking level/order as Foundry's hotbar. We intentionally do NOT
// re-parent it into #ui-bottom: transformed UI containers change the containing block
// for position:fixed and would shift the HUD on screen.
function _hotbarRootBranch(){
  const hb=document.getElementById("hotbar");
  if(!hb)return null;
  let el=hb;
  while(el.parentElement&&el.parentElement!==document.body)el=el.parentElement;
  return el?.parentElement===document.body?el:null;
}
function _createsStackingContext(el,cs){
  if(!el||!cs)return false;
  const z=cs.zIndex;
  const positioned=cs.position!=="static";
  if(z!=="auto"&&(positioned||["flex","inline-flex","grid","inline-grid"].includes(cs.display)))return true;
  if(Number(cs.opacity)<1)return true;
  if(cs.transform!=="none"||cs.perspective!=="none"||cs.filter!=="none")return true;
  if(cs.backdropFilter&&cs.backdropFilter!=="none")return true;
  if(cs.isolation==="isolate")return true;
  if(cs.mixBlendMode&&cs.mixBlendMode!=="normal")return true;
  if(cs.contain?.includes?.("paint")||cs.contain?.includes?.("layout"))return true;
  return false;
}
function _hotbarRootStackZ(){
  const hb=document.getElementById("hotbar");
  if(!hb)return null;
  const chain=[];
  for(let el=hb;el&&el!==document.body&&el!==document.documentElement;el=el.parentElement)chain.push(el);
  chain.reverse();
  // The outermost stacking context controls how the whole hotbar branch competes
  // with windows/modules at document.body level. Inner z-index values cannot escape it.
  for(const el of chain){
    const cs=globalThis.getComputedStyle?.(el);
    if(!_createsStackingContext(el,cs))continue;
    const z=cs?.zIndex;
    return z&&z!=="auto"&&Number.isFinite(Number(z))?Number(z):0;
  }
  return 0;
}
function _mountHudSurface(el){
  if(!el)return el;
  const root=_hotbarRootBranch();
  // Body keeps position:fixed in viewport coordinates. Insert immediately before the
  // hotbar's top-level UI branch so equal-z module/UI surfaces paint over both alike.
  if(el.parentElement!==document.body){
    if(root)document.body.insertBefore(el,root);
    else document.body.appendChild(el);
  }else if(root&&el.nextSibling!==root){
    document.body.insertBefore(el,root);
  }
  const z=_hotbarRootStackZ();
  if(z!==null)el.style.zIndex=String(z);
  return el;
}

function _ttE(){let t=document.getElementById(TT);if(t)return _mountHudSurface(t);t=document.createElement("div");t.id=TT;t.className="oth-tip";return _mountHudSurface(t);}
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

// Foundry v14 gives non-chat sidebar tabs more horizontal space than Chat.
// Compact the core hotbar while one of those tabs is open; slots 9 and 0 are
// hidden only visually, so their assigned macros and shortcuts remain intact.
function _syncHotbarSidebarState(){
  const sidebar=globalThis.ui?.sidebar;
  const activeTab=sidebar?.tabGroups?.primary||(globalThis.ui?.chat?.active?"chat":null);
  const compact=Boolean(sidebar?.expanded&&activeTab&&activeTab!=="chat");
  document.body?.classList.toggle(HOTBAR_COMPACT_CLASS,compact);

  // Toggle the class synchronously so Foundry's own hotbar offset never paints.
  // Reposition TokenHUD on the next frame, after the compact geometry is final.
  if(_sidebarSyncRaf)cancelAnimationFrame(_sidebarSyncRaf);
  _sidebarSyncRaf=requestAnimationFrame(()=>{
    _sidebarSyncRaf=0;
    const hud=document.getElementById(OTH);
    if(hud)_pos(hud);
    if(_actionPopupType)_refreshActionPopup();
  });
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
  h+=`<div class="oth-nm"><span class="oth-name-glyph" aria-hidden="true">◆</span><span class="oth-name-text">${_e(actor.name)}</span><span class="oth-name-glyph" aria-hidden="true">◆</span></div>`;
  h+=`<div class="oth-portrait-stage"><div class="oth-avatar-ring"><div class="oth-pic" data-act="sh" title="Открыть лист персонажа"><img src="${actor.img||"icons/svg/mystery-man.svg"}" alt="" draggable="false"/></div></div></div>`;
  h+=`<div class="oth-ov"><div class="oth-ov-grid">`;
  h+=`<div class="oth-ob oth-ob-stress" title="Стресс"><i class="fa-solid fa-ghost" aria-hidden="true"></i><span class="oth-ob-label">Стресс</span><div class="oth-ob-readout"><input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Текущий стресс" class="oth-inp" data-f="system.Stress.value" value="${Number(st.value??0)}" data-res="Stress"/><span class="oth-ob-rule" aria-hidden="true"></span><b>${Number(st.max??100)}</b></div></div>`;
  h+=`<div class="oth-ob oth-ob-health" title="ХП"><i class="fa-solid fa-heart" aria-hidden="true"></i><span class="oth-ob-label">ХП</span><div class="oth-ob-readout"><input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Текущие ХП" class="oth-inp" data-f="system.Health.value" value="${Number(hp.value??0)}" data-res="Health"/><span class="oth-ob-rule" aria-hidden="true"></span><b>${Number(hp.max??0)}</b></div></div>`;
  h+=`<div class="oth-ob oth-ob-mana" title="Магическая усталость"><i class="fa-solid fa-droplet" aria-hidden="true"></i><span class="oth-ob-label">Маг. уст.</span><div class="oth-ob-readout"><input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Текущая магическая усталость" class="oth-inp" data-f="system.ManaFatigue.value" value="${Number(mn.value??0)}" data-res="ManaFatigue"/><span class="oth-ob-rule" aria-hidden="true"></span><b>${Number(mn.max??0)}</b></div></div>`;
  h+=`</div><div class="oth-derived">`;
  h+=`<div class="oth-derived-stat oth-armor" title="Броня"><i class="fa-solid fa-shield" aria-hidden="true"></i><span>Броня</span><b>${arm}</b></div>`;
  h+=`<div class="oth-derived-stat oth-speed" title="Скорость"><i class="fa-solid fa-running" aria-hidden="true"></i><span>Скорость</span><b>${spd+spdM}</b></div>`;
  h+=`</div></div></div>`;

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
    h+=`<div class="oth-sc" data-a="${c.k}"><img class="oth-char-icon" src="${c.i}" alt="" aria-hidden="true" draggable="false"><b>${v}</b>`;
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

function _show(a,t){
  const previousActorId=_a?.id??null;
  const sameActor=!!(a?.id&&previousActorId===a.id);
  const keepPopup=!!(_actionPopupType&&sameActor);
  if(!keepPopup)_actionPopupType=null;
  _closeActionPopup(false);
  _a=a;_t=t;_dismissed=false;

  const current=document.getElementById(OTH);
  if(!a||!_canView(a)){current?.remove();return;}

  const w=document.createElement("div");
  w.innerHTML=_build(a);
  const fresh=w.firstElementChild;

  // For the same actor keep the already mounted portrait stage (especially its GIF <img>) alive.
  // Recreating the whole left block restarts/recomposites animated portraits and can produce a
  // one-frame flash. Dynamic HUD parts are still refreshed from the newly built markup.
  if(current&&sameActor){
    _listen(fresh,a);

    const currentPort=current.querySelector(".oth-port");
    const freshPort=fresh.querySelector(".oth-port");
    const currentStage=currentPort?.querySelector(".oth-portrait-stage");
    const freshStage=freshPort?.querySelector(".oth-portrait-stage");
    const currentImg=currentStage?.querySelector(".oth-pic>img");
    const freshImg=freshStage?.querySelector(".oth-pic>img");
    if(currentImg&&freshImg&&currentImg.getAttribute("src")!==freshImg.getAttribute("src")){
      currentImg.setAttribute("src",freshImg.getAttribute("src")||"icons/svg/mystery-man.svg");
    }

    const currentName=currentPort?.querySelector(".oth-nm");
    const freshName=freshPort?.querySelector(".oth-nm");
    if(currentName&&freshName)currentName.replaceWith(freshName);

    const currentOverlay=currentPort?.querySelector(".oth-ov");
    const freshOverlay=freshPort?.querySelector(".oth-ov");
    if(currentOverlay&&freshOverlay)currentOverlay.replaceWith(freshOverlay);

    const currentUpper=current.querySelector(".oth-upper");
    const freshUpper=fresh.querySelector(".oth-upper");
    if(currentUpper&&freshUpper){
      freshUpper.classList.add("v");
      currentUpper.replaceWith(freshUpper);
    }

    _syncResourceInputs(a);
    _pos(current);
    if(_actionPopupType)requestAnimationFrame(()=>_refreshActionPopup(a));
    return;
  }

  current?.remove();
  _mountHudSurface(fresh);
  _listen(fresh,a);
  _syncResourceInputs(a);
  _pos(fresh);
  requestAnimationFrame(()=>{
    fresh.querySelector(".oth-port")?.classList.add("v");
    fresh.querySelector(".oth-upper")?.classList.add("v");
    if(_actionPopupType)_refreshActionPopup(a);
  });
}
function _hide(){const h=document.getElementById(OTH);if(h){h.querySelectorAll(".v").forEach(e=>e.classList.remove("v"));setTimeout(()=>h.remove(),200);}_closeActionPopup(true);_a=null;_t=null;_dismissed=false;_ttH();}
function _dismiss(){const h=document.getElementById(OTH);if(h){h.querySelectorAll(".v").forEach(e=>e.classList.remove("v"));setTimeout(()=>h.remove(),200);}_closeActionPopup(true);_dismissed=true;_ttH();}
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
  const expr=_inpExpr(inp);
  const current=_inpActorVal(actor,inp);
  if(!expr){
    _setInpDisplay(inp,_num(inp?.dataset?.lastCommitted)??current);
    return;
  }

  // A leading + or - is an arithmetic adjustment; an unsigned number remains an absolute value.
  // Examples: HP 240 + input "-20" => 220; Stress 15 + input "+15" => 30.
  const next=expr.relative?current+expr.value:expr.value;
  _setInpDisplay(inp,next);
  if(!force&&next===current)return;
  inp.dataset.committing="1";
  try{
    await actor.update({[f]:next});
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
  // v13+: плашка игроков внизу слева — начинаем HUD правее неё, не перекрывая.
  // Берём максимальный правый край среди всех видимых players-элементов
  // (в новом UI #players может быть свёрнут, а видимая плашка — вложенный блок).
  let baseL=0;
  try{
    const cand=document.querySelectorAll('#players, #players-active, #players-inactive, #player-list, aside.players, [id^="players"], #players *');
    let best=0;
    for(const el of cand){
      const pr=el.getBoundingClientRect?.();
      if(!pr||pr.width<=0||pr.height<=0)continue;
      if(pr.left>window.innerWidth/3)continue;      // только левый край экрана
      if(pr.bottom<window.innerHeight*0.6)continue; // только нижняя зона
      if(pr.right>best)best=pr.right;
    }
    if(best>0)baseL=Math.ceil(best)+10;
  }catch(e){}
  const portW=Math.max(150,Math.min(m.colR-baseL,330));
  // Keep the portrait panel just to the left of the Foundry hotbar.
  // On v14 the hotbar root starts before its control buttons, so anchoring to
  // m.l removes the otherwise visible ~30px horizontal gap without overlap.
  const HOTBAR_GAP=4;
  const portL=Math.max(baseL,Math.floor(m.l-portW-HOTBAR_GAP));

  // Upper block: above hotbar
  const uBot=window.innerHeight-m.t+2;
  const uL=portL+portW+2;
  const uR=Math.min(m.pgR+4,m.r+44);
  upper.style.left=uL+"px";
  upper.style.bottom=uBot+"px";
  upper.style.width=Math.max(140,(uR-uL))+"px";
  upper.style.height=UPPER_H+"px";

  // Portrait: bottom = hotbar bottom, top = same as upper top
  const portH=m.h+2+UPPER_H;
  port.style.left=portL+"px";
  port.style.bottom=(window.innerHeight-m.b)+"px";
  port.style.width=portW+"px";
  port.style.height=portH+"px";
}

function _listen(hud,actor){
  hud.querySelector(".oth-pic")?.addEventListener("click",e=>{if(e.target.closest(".oth-inp"))return;(_hudActor()||actor)?.sheet?.render(true);});
  hud.querySelectorAll(".oth-inp").forEach(inp=>{
    _setInpDisplay(inp,_inpActorVal(actor,inp));
    inp.addEventListener("mousedown",e=>e.stopPropagation());
    inp.addEventListener("click",e=>e.stopPropagation());
    inp.addEventListener("focus",ev=>ev.target.select());
    inp.addEventListener("input",ev=>{
      const el=ev.currentTarget;
      const raw=String(el.value??"");
      const sign=raw.startsWith("-")?"-":raw.startsWith("+")?"+":"";
      const digits=raw.replace(/[^\d]/g,"");
      el.value=sign+digits;
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
    mainBtn.addEventListener("mousedown",ev=>{if(ev.button===1){ev.preventDefault();ev.stopPropagation();_toggleActionPopup(actor,"main",mainBtn);}});
    mainBtn.addEventListener("auxclick",ev=>{if(ev.button===1){ev.preventDefault();ev.stopPropagation();}});
    mainBtn.addEventListener("contextmenu",async ev=>{
      ev.preventDefault();
      const cur=_getMainAction(actor);
      const name=actor?.name||"Персонаж";
      const status=cur?"есть":"нет";
      await ChatMessage.create({
        speaker:ChatMessage.getSpeaker({actor}),
        content:`<p><strong>${_e(name)}</strong> — ${status} Основное действие</p>`,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    });
    mainBtn.addEventListener("mouseenter",ev=>{
      const cur=_getMainAction(actor);
      _ttS(ev,`<div class="oth-tip-t">Основное действие</div><div class="oth-tip-r"><span>Статус:</span><b style="color:${cur?"#3cb44b":"#ff3b3b"};">${cur?"Доступно":"Использовано"}</b></div><div class="oth-tip-h">ЛКМ — переключить · СКМ — список · ПКМ — в чат</div>`);
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
    bonusBtn.addEventListener("mousedown",ev=>{if(ev.button===1){ev.preventDefault();ev.stopPropagation();_toggleActionPopup(actor,"bonus",bonusBtn);}});
    bonusBtn.addEventListener("auxclick",ev=>{if(ev.button===1){ev.preventDefault();ev.stopPropagation();}});
    bonusBtn.addEventListener("contextmenu",async ev=>{
      ev.preventDefault();
      const cur=_getBonusAction(actor);
      const name=actor?.name||"Персонаж";
      const status=cur?"есть":"нет";
      await ChatMessage.create({
        speaker:ChatMessage.getSpeaker({actor}),
        content:`<p><strong>${_e(name)}</strong> — ${status} Бонусное действие</p>`,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    });
    bonusBtn.addEventListener("mouseenter",ev=>{
      const cur=_getBonusAction(actor);
      _ttS(ev,`<div class="oth-tip-t">Бонусное действие</div><div class="oth-tip-r"><span>Статус:</span><b style="color:${cur?"#3cb44b":"#ff3b3b"};">${cur?"Доступно":"Использовано"}</b></div><div class="oth-tip-h">ЛКМ — переключить · СКМ — список · ПКМ — в чат</div>`);
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
    card.addEventListener("mouseenter",ev=>{const item=actor.items.get(id);if(!item)return;let tt=`<div class="oth-tip-t">${_e(item.name)}</div>`;const d=String(item.system?.Description||item.system?.description||"").substring(0,180);if(d)tt+=`<div style="font-size:10px;color:rgba(238,243,255,0.6);margin:3px 0;">${_e(d)}</div>`;if(item.type==="Skill"||item.type==="Spell"){const actionCost=String(item.system?.ActionCost??item.system?.actionCost??"").trim()||"—";tt+=`<div class="oth-tip-r" style="display:block;"><span style="display:block;">Стоимость действий:</span><b style="display:block;margin-top:2px;line-height:1.35;text-align:left;">${_actionCostHtml(actionCost)}</b></div>`;}tt+=`<div class="oth-tip-h">ЛКМ — использовать · ПКМ — лист</div>`;_ttS(ev,tt);});
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
  Hooks.on("changeSidebarTab",_syncHotbarSidebarState);
  Hooks.on("collapseSidebar",_syncHotbarSidebarState);
  _syncHotbarSidebarState();

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
  const view=canvas?.app?.canvas??canvas?.app?.view;
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
    if(_actionPopupType)_refreshActionPopup(fresh);
  });
  const _ri=o=>{
    if(!_a||_dismissed||!(o?.id===_a.id||o?.parent?.id===_a.id))return;
    _ref();
  };
  for(const h of["createItem","updateItem","deleteItem","createActiveEffect","updateActiveEffect","deleteActiveEffect"])Hooks.on(h,_ri);
  Hooks.on("canvasTearDown",_hide);
  window.addEventListener("resize",_syncHotbarSidebarState);
  // ESC to dismiss
  document.addEventListener("keydown",ev=>{
    if(ev.key!=="Escape")return;
    if(document.getElementById(ACTION_POPUP_ID)){
      ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
      _closeActionPopup(true);
      return;
    }
    if(document.getElementById(OTH)){
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
      if(_actionPopupType&&_a)_refreshActionPopup(_a);
    }catch(e){
      console.warn("Order | TokenHud updateCombat reset failed",e);
    }
  });

  try{const c=canvas?.tokens?.controlled?.[0];if(c?.actor)_show(c.actor,c);}catch{}
});
