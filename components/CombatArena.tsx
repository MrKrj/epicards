'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { Activity, BookOpen, Bot, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Cloud, CloudLightning, Cpu, Crown, Database, Eye, Flame, GitBranch, Layers, LoaderCircle, Search, Shield, Snowflake, Sparkles, Sun, Swords, Target, Trophy, Users, Wind, X, Zap } from 'lucide-react';
import { COMBAT_ROWS, RARITY_EFFECT, getCombatBasePower, getCombatRarityExplanation, type BoardCard, type CombatCard, type CombatRow, type CombatSide, type CombatWeatherId } from '@/lib/combat-engine';
import { COMBAT_ROLES, getCombatProfile, getCombatRoleInfo, type CombatRoleId } from '@/lib/combat-profiles';

type UserLike={id:number;username:string;role?:string}|null;
type OwnedCard=CombatCard&{quantity:number};
type CombatDeckReference={cardId:string;isShiny:boolean};
type SavedCombatDeck={id:string;name:string;cards:CombatDeckReference[];updatedAt:number};
type BattleCardSnapshot=BoardCard&{power:number;effectTone:'positive'|'negative'|'mixed'|null;effectReasons:string[];effectBonuses:string[];effectMaluses:string[];effectNotes:string[]};
type PlayerOption={id:number;username:string};
type MatchSummary={id:string;mode:'ai'|'pvp';status:string;player1_id:number;player2_id:number|null;created_at:number;updated_at:number;player1_name:string;player2_name:string|null};
type MatchRecord={played:number;wins:number};
type BattleState={version:number;mode:'ai'|'pvp';status:'active'|'finished';winner:CombatSide|'draw'|null;players:Record<CombatSide,{id:number|null;username:string}>;round:number;turn:CombatSide;viewer:CombatSide;passed:CombatSide[];roundsWon:Record<CombatSide,number>;weather:{id:CombatWeatherId;name:string;row:CombatRow|null;description:string};hand:CombatCard[];handCount:number;opponentHandCount:number;board:Record<CombatSide,Record<CombatRow,BattleCardSnapshot[]>>;score:Record<CombatSide,number>;rowScore:Record<CombatSide,Record<CombatRow,number>>;history:Array<{round:number;winner:CombatSide|'draw';p1:number;p2:number;p1Lanes?:number;p2Lanes?:number;weather:CombatWeatherId}>;log:Array<{id:number;text:string;kind:'play'|'effect'|'pass'|'round'|'weather'}>};
type MatchDetail={id:string;mode:'ai'|'pvp';status:string;player1:{id:number;username:string};player2:{id:number|null;username:string};createdAt:number;updatedAt:number};
type RawCard={id:string;name:string;rarity:string;category:string;set_id:string;set_name:string;image_url:string|null;is_shiny:number|boolean;quantity:number;role_id?:CombatRoleId|null;combat_power?:number|null;stability?:number|null;expertise?:number|null};
type Props={user:UserLike;onLogin:()=>void;view?:'combat'|'decks';onNavigateToDeck?:()=>void;theme?:'dark'|'light'};

const rarityClass:Record<string,string>={Commune:'common','Peu commune':'uncommon',Rare:'rare','Épique':'epic','Légendaire':'legendary','Secrète':'secret'};
const rarityColor:Record<string,string>={Commune:'#999da5','Peu commune':'#57a2ff',Rare:'#55d883','Épique':'#ffd64a','Légendaire':'#ff914b','Secrète':'#fa5757'};
const combatRarityOrder:Record<string,number>={Secrète:0,'Légendaire':1,'Épique':2,Rare:3,'Peu commune':4,Commune:5};
const rarityEffectIcons:Record<string,typeof Circle>={Commune:Circle,'Peu commune':Users,Rare:Zap,'Épique':Eye,'Légendaire':Shield,'Secrète':Swords};
const roleEffectIcons:Record<CombatRoleId,typeof Circle>={ci_cd:GitBranch,api:Database,stack:Layers,ram:Cpu,elasticity_cloud:Cloud,unit_test:CheckCircle2};
const rowTech:Record<CombatRow,string>={melee:'Client',ranged:'Réseau',siege:'Serveur'};
const weatherNames:Record<CombatWeatherId,string>={clear:'Système nominal',frost:'Panne thermique',fog:'Latence réseau',storm:'Surcharge serveur'};
const weatherIcon:Record<CombatWeatherId,typeof Sun>={clear:Sun,frost:Snowflake,fog:Wind,storm:CloudLightning};
const rarityGuide=[
  {rarity:'Commune',effect:'Base 3',text:'Aucun effet spécial : elle apporte ses points.'},
  {rarity:'Peu commune',effect:'Base 2 · Renforce les alliées',text:'Chaque Peu commune renforce les autres cartes alliées de son canal de +1 (maximum +2).'},
  {rarity:'Rare',effect:'Base 4 · Double sa puissance',text:'Double sa puissance si une carte alliée de la même série est sur ce canal.'},
  {rarity:'Épique',effect:'Base 1 · Espion',text:'Va chez l’adversaire, mais ses points sont pour toi. Elle neutralise aussi l’effet technique de la carte adverse la plus puissante de ce canal jusqu’à la fin de la manche.'},
  {rarity:'Légendaire',effect:'Base 5 · Ignore la météo',text:'Ignore la météo et ne peut pas être détruite par une Secrète.'},
  {rarity:'Secrète',effect:'Base 2 · Retire les plus fortes',text:'Retire les cartes adverses qui ont le plus de points sur ce canal. Les Légendaires résistent.'},
];
const weatherGuide=[['clear','Système nominal','Aucune anomalie'],['frost','Panne thermique','Client · puissance non protégée limitée à 1'],['fog','Latence réseau','Réseau · puissance non protégée limitée à 1'],['storm','Surcharge serveur','Serveur · puissance non protégée limitée à 1 · pluie de données'] ] as const;
const keyOf=(card:Pick<CombatCard,'id'|'isShiny'>)=>`${card.id}:${card.isShiny?1:0}`;
const limitRarities=['Rare','Épique','Légendaire','Secrète'];
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').trim();
const weatherNameFor=(weather:CombatWeatherId)=>weatherNames[weather];
function newlyPlacedCard(before:BattleState|null,after:BattleState|null){
  if(!before||!after)return null;
  const oldCounts=new Map<string,number>();
  for(const card of (['p1','p2'] as const).flatMap(side=>COMBAT_ROWS.flatMap(row=>before.board[side][row]))){const key=`${card.owner}:${card.id}:${card.isShiny?1:0}`;oldCounts.set(key,(oldCounts.get(key)??0)+1)}
  for(const card of (['p1','p2'] as const).flatMap(side=>COMBAT_ROWS.flatMap(row=>after.board[side][row]))){const key=`${card.owner}:${card.id}:${card.isShiny?1:0}`,count=oldCounts.get(key)??0;if(count===0)return card;oldCounts.set(key,count-1)}
  return null;
}
function CardMemoryMarks({card,role}:{card:Pick<CombatCard,'rarity'|'setName'>;role:CombatRoleId}){
  const RarityIcon=rarityEffectIcons[card.rarity]??Circle,RoleIcon=roleEffectIcons[role],roleInfo=getCombatRoleInfo({role});
  const rarityIconLabel=`Effet ${card.rarity} : ${RARITY_EFFECT[card.rarity]??'effet spécial'}. ${getCombatRarityExplanation(card)}`;
  const roleIconLabel=`Rôle ${roleInfo.module} : ${roleInfo.description}`;
  return <><span className="combat-card-memory-mark rarity-effect" role="img" aria-label={rarityIconLabel} title={rarityIconLabel}><RarityIcon size={11} aria-hidden="true"/></span><span className="combat-card-memory-mark technical-role" role="img" aria-label={roleIconLabel} title={roleIconLabel}><RoleIcon size={11} aria-hidden="true"/></span></>;
}

function CombatEffectRow({Icon,label,text,variant}:{Icon:typeof Circle;label:string;text:string;variant:'rarity'|'technical'}){
  return <div className={`combat-hover-effect-row ${variant}`}><span aria-hidden="true"><Icon size={19}/></span><span><small>{label}</small><strong>{text}</strong></span></div>;
}

export function CombatEffectRows({card}:{card:CombatCard}){
  const profile=getCombatProfile(card),role=getCombatRoleInfo(profile),RarityIcon=rarityEffectIcons[card.rarity]??Circle,RoleIcon=roleEffectIcons[profile.role];
  return <div className="combat-hover-effect-stack">
    <CombatEffectRow Icon={RarityIcon} label="EFFET DE RARETÉ" text={getCombatRarityExplanation(card)} variant="rarity"/>
    <CombatEffectRow Icon={RoleIcon} label={`EFFET DE RÈGLE TECHNIQUE · ${role.module}`} text={role.description} variant="technical"/>
  </div>;
}

function CombatCardEffectOverlay({id,card,theme,style,selected=false,prompt,fieldStatus,onMouseEnter,onMouseLeave}:{id?:string;card:CombatCard;theme:'dark'|'light';style:CSSProperties;selected?:boolean;prompt?:string;fieldStatus?:{tone:'positive'|'negative'|'mixed'|null;bonuses:string[];maluses:string[];notes:string[];power:number};onMouseEnter?:()=>void;onMouseLeave?:()=>void}){
  const profile=getCombatProfile(card),role=getCombatRoleInfo(profile),StatusIcon=fieldStatus?.tone==='positive'?Zap:fieldStatus?.tone==='negative'?Flame:fieldStatus?.tone==='mixed'?Activity:Circle;
  const statusLabel=fieldStatus?.tone==='mixed'?'BONUS ET MALUS ACTIFS':fieldStatus?.tone==='positive'?'BONUS ACTIFS':fieldStatus?.tone==='negative'?'MALUS ACTIFS':'AUCUN BONUS OU MALUS ACTIF';
  return <div id={id} className={`combat-hover-effect-panel ${rarityClass[card.rarity]??'common'}${theme==='light'?' combat-light':''}${selected?' is-selected':''}${fieldStatus?' has-field-status':''}`} style={style} role="tooltip" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
    <div className="combat-hover-effect-content">
      <header className="combat-hover-effect-header"><span><Sparkles size={17}/></span><div><small>{card.category} · {card.setName} · {card.rarity}{card.isShiny?' · SHINY':''}</small><b>{card.name}</b></div></header>
      <CombatEffectRows card={card}/>
      {fieldStatus&&<section className={`combat-hover-field-status ${fieldStatus.tone??'neutral'}`}>
        <header><span><StatusIcon size={17}/></span><div><small>EFFET SUR LE CHAMP DE BATAILLE</small><b>{statusLabel}</b></div><strong>{fieldStatus.power}<small>PTS</small></strong></header>
        {fieldStatus.bonuses.map((reason,index)=><p className="combat-effect-outcome positive" key={`bonus-${index}`}><Zap size={14}/><b>Bonus actif</b><span>{reason}</span></p>)}
        {fieldStatus.maluses.map((reason,index)=><p className="combat-effect-outcome negative" key={`malus-${index}`}><Flame size={14}/><b>Malus actif</b><span>{reason}</span></p>)}
        {fieldStatus.notes.map((reason,index)=><p className="combat-effect-outcome neutral" key={`note-${index}`}><Activity size={14}/><b>Neutralisé</b><span>{reason}</span></p>)}
        {!fieldStatus.bonuses.length&&!fieldStatus.maluses.length&&!fieldStatus.notes.length&&<p className="combat-effect-outcome neutral"><Circle size={14}/><span>Aucun bonus ni malus ne modifie cette carte actuellement.</span></p>}
      </section>}
      {prompt&&<small className="combat-overlay-prompt">{prompt}</small>}
    </div>
  </div>;
}

function fullCombatExplanation(card:CombatCard){
  const role=getCombatRoleInfo(getCombatProfile(card));
  return `${card.rarity} · ${getCombatRarityExplanation(card)} Effet ${role.module} : ${role.description} Puissance de base : ${getCombatBasePower(card)} points.`;
}

type TutorialStep={title:string;body:string;selector?:string;label:string};
type TurnAnnouncement={kind:'daemon'|'daemon-play'|'your-turn'|'round'|'match';title:string;detail?:string;outcome?:'win'|'loss'|'draw'};
const wait=(milliseconds:number)=>new Promise<void>(resolve=>window.setTimeout(resolve,milliseconds));
const lobbyTutorial:TutorialStep[]=[
  {label:'LE BUT',title:'Gagner deux manches',body:'Chaque combat se joue en trois manches maximum. Pour gagner une manche, il faut avoir plus de points que l’adversaire sur au moins deux des trois lignes : le total général ne compte pas. Le premier joueur qui remporte deux manches gagne le duel.'},
  {label:'TON DECK',title:'Choisis 8 à 12 cartes',body:'Clique sur les cartes pour les ajouter à ton deck. Tu peux en prendre plusieurs Communes et Peu communes, mais une seule de chaque rareté à partir de Rare. Les catégories des cartes ne changent pas leurs règles de combat.',selector:'[data-combat-tutorial="deck"]'},
  {label:'PUISSANCE',title:'La puissance de base est déjà calculée',body:'Le chiffre affiché sur la carte intègre son profil automatique. Tu n’as pas à calculer ni à gérer les statistiques séparément ; seuls les effets de rareté, de rôle et de terrain peuvent modifier cette valeur pendant le combat.',selector:'[data-combat-tutorial="cards"]'},
  {label:'LES RARETÉS',title:'Chaque rareté a une règle simple',body:'Commune : aucun bonus. Peu commune : renforce les alliées de son canal. Rare : double ses points avec une alliée de la même série. Épique : va chez l’adversaire, marque pour toi et neutralise un effet technique sur son canal. Légendaire : ignore météo et Secrètes. Secrète : retire la carte adverse la plus forte du canal, sauf une Légendaire. Ouvre « Règles & effets » pour relire les détails.',selector:'[data-combat-tutorial="rules-button"]'},
  {label:'LES EFFETS',title:'Six effets techniques différents',body:'CI/CD renforce ses alliées sur le même canal ; API gagne +2 ; Stack progresse au fil des cartes jouées ; RAM revient une manche à demi-puissance ; Elasticity Cloud soutient la meilleure alliée d’un autre canal ; Unit Test affaiblit la meilleure carte adverse sur son canal. Une Épique peut neutraliser l’un de ces effets pour la manche.',selector:'[data-combat-tutorial="rules-button"]'},
  {label:'LANCER LE DUEL',title:'Choisis ton adversaire',body:'Entraîne-toi contre le Daemon ou envoie un défi à un joueur. Une fois ton deck prêt, lance le combat. Les cartes utilisées restent dans ta collection.',selector:'[data-combat-tutorial="launch"]'},
];
const battleTutorial:TutorialStep[]=[
  {label:'MANCHE',title:'Prends deux lignes sur trois',body:'Sur chaque ligne, le camp avec le plus de points remporte cette ligne. Il faut être en tête sur au moins deux des trois lignes pour gagner la manche ; le total général des points ne départage pas la manche. Le premier joueur à gagner deux manches remporte le combat.',selector:'[data-combat-tutorial="rounds"]'},
  {label:'INCIDENTS',title:'Un incident touche un canal',body:'Un incident est tiré au hasard au début de chaque manche. Panne thermique touche Client, Latence touche Réseau, Surcharge touche Serveur. Les cartes touchées sont limitées à 1 point, sauf les Légendaires.',selector:'[data-combat-tutorial="weather"]'},
  {label:'CANAUX',title:'Place chaque carte sur un canal',body:'Les trois canaux sont Client, Réseau et Serveur. Sur ordinateur, glisse une carte depuis ta main. Sur mobile, touche une carte puis le canal. Les nombres au centre comparent les points de chaque camp.',selector:'[data-combat-tutorial="lanes"]'},
  {label:'PUISSANCE',title:'Le chiffre dans le cercle compte pour le score',body:'La puissance de base affichée intègre déjà le profil automatique de la carte. Les seuls changements visibles en jeu viennent des effets de rareté, du rôle technique et de l’incident système.',selector:'[data-combat-tutorial="hand"]'},
  {label:'TA MAIN',title:'Lis la carte avant de la jouer',body:'Survole ou sélectionne une carte pour lire son effet de rareté, son rôle technique, ainsi que les bonus et malus actifs. Le rôle ajoute +1 puissance si sa condition est remplie, sauf si la météo limite le canal. Toutes tes cartes sont disponibles dans ta main dès le début.',selector:'[data-combat-tutorial="hand"]'},
  {label:'EFFETS',title:'Les flèches expliquent les changements',body:'La flèche bleue vers le haut signale un bonus actif. La flèche rouge vers le bas signifie que la carte perd de la puissance, par exemple à cause de la météo ou d’un effet adverse. Survole cette carte pour lire la cause précise.',selector:'[data-combat-tutorial="effects"]'},
  {label:'PASSER',title:'Passer sert à économiser sa main',body:'Passer arrête tes actions pour cette manche, mais ne quitte pas le combat. L’adversaire peut continuer. Les cartes gardées en main restent disponibles pour la manche suivante. Quand les deux camps passent, le score décide la manche.',selector:'[data-combat-tutorial="pass"]'},
];

function GuidedTutorial({steps,onClose}:{steps:TutorialStep[];onClose:()=>void}){
  const [stepIndex,setStepIndex]=useState(0),[mounted,setMounted]=useState(false),[spotlight,setSpotlight]=useState<{top:number;left:number;width:number;height:number}|null>(null);
  const savedScroll=useRef<{windowX:number;windowY:number;elements:Array<{element:HTMLElement;top:number;left:number}>}|null>(null);
  const current=steps[stepIndex];
  useEffect(()=>{
    const scrollables=Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(element=>{
      const style=window.getComputedStyle(element),canScroll=/auto|scroll|hidden/.test(`${style.overflowY} ${style.overflowX}`);
      return canScroll&&(element.scrollHeight>element.clientHeight+1||element.scrollWidth>element.clientWidth+1);
    });
    savedScroll.current={windowX:window.scrollX,windowY:window.scrollY,elements:scrollables.map(element=>({element,top:element.scrollTop,left:element.scrollLeft}))};
    setMounted(true);
    return()=>{
      const snapshot=savedScroll.current;if(!snapshot)return;
      const root=document.documentElement,previousBehavior=root.style.scrollBehavior;root.style.scrollBehavior='auto';
      for(const item of snapshot.elements){item.element.scrollTop=item.top;item.element.scrollLeft=item.left}
      window.scrollTo(snapshot.windowX,snapshot.windowY);
      requestAnimationFrame(()=>{for(const item of snapshot.elements){item.element.scrollTop=item.top;item.element.scrollLeft=item.left}window.scrollTo(snapshot.windowX,snapshot.windowY);root.style.scrollBehavior=previousBehavior});
    };
  },[]);
  useEffect(()=>{
    if(!mounted)return;
    const target=current?.selector?document.querySelector<HTMLElement>(current.selector):null;
    if(!target){setSpotlight(null);return}
    target.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
    let frame=0;
    const update=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const rect=target.getBoundingClientRect();setSpotlight({top:rect.top-7,left:rect.left-7,width:rect.width+14,height:rect.height+14})})};
    const timer=window.setTimeout(update,220);window.addEventListener('resize',update);window.addEventListener('scroll',update,true);update();
    return()=>{window.clearTimeout(timer);cancelAnimationFrame(frame);window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true)};
  },[current,mounted]);
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose();if(event.key==='ArrowRight')setStepIndex(value=>Math.min(steps.length-1,value+1));if(event.key==='ArrowLeft')setStepIndex(value=>Math.max(0,value-1))};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[onClose,steps.length]);
  if(!mounted||!current)return null;
  const last=stepIndex===steps.length-1;
  const placement=spotlight&&spotlight.top+spotlight.height/2>window.innerHeight*.55?'at-top':'at-bottom';
  return createPortal(<div className="combat-tutorial-root" role="presentation">
    <div className={`combat-tutorial-scrim${spotlight?' has-spotlight':''}`} aria-hidden="true"/>
    {spotlight&&<div className="combat-tutorial-spotlight" style={{top:spotlight.top,left:spotlight.left,width:spotlight.width,height:spotlight.height}} aria-hidden="true"/>}
    <section className={`combat-tutorial-card ${placement}`} role="dialog" aria-modal="true" aria-labelledby="combat-tutorial-title" aria-describedby="combat-tutorial-description">
      <div className="combat-tutorial-top"><span>{current.label} · {String(stepIndex+1).padStart(2,'0')} / {String(steps.length).padStart(2,'0')}</span><button type="button" onClick={onClose} aria-label="Fermer le tutoriel"><X size={16}/></button></div>
      <div className="combat-tutorial-progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={stepIndex+1}><i style={{width:`${(stepIndex+1)/steps.length*100}%`}}/></div>
      <h3 id="combat-tutorial-title">{current.title}</h3><p id="combat-tutorial-description">{current.body}</p>
      <div className="combat-tutorial-actions"><button type="button" className="combat-tutorial-back" onClick={()=>setStepIndex(value=>Math.max(0,value-1))} disabled={stepIndex===0}>← Précédent</button><button type="button" className="combat-tutorial-next" onClick={()=>last?onClose():setStepIndex(value=>Math.min(steps.length-1,value+1))}>{last?'Terminer':'Suivant →'}</button></div>
      <small className="combat-tutorial-hint">Tu peux aussi naviguer avec ← → ou fermer avec Échap.</small>
    </section>
  </div>,document.body);
}

type RulebookTopic='cards'|'roles'|'incidents';
const rulebookTopics:{id:RulebookTopic;label:string;Icon:typeof Shield}[]=[{id:'cards',label:'Règles des cartes',Icon:Shield},{id:'roles',label:'Rôles techniques',Icon:Bot},{id:'incidents',label:'Incidents système',Icon:CloudLightning}];

function CombatRulebookContent({topic}:{topic:RulebookTopic}){
  return <section className="combat-explainer" aria-label={rulebookTopics.find(item=>item.id===topic)?.label??'Règles de combat'}>
    {topic==='cards'&&<><div className="combat-explainer-heading"><span className="combat-kicker">RÈGLES DES CARTES</span><small>La rareté donne une règle simple. Le rôle technique ajoute un bonus conditionnel.</small></div><p className="combat-victory-rule">Pour gagner une manche, prends au moins <strong>2 lignes sur 3</strong> : chaque ligne est remportée par le camp qui y a le plus de points. Le total des points ne remplace pas cette règle.</p><div className="combat-effect-guide" data-combat-tutorial="rarities">{rarityGuide.map(info=><article key={info.rarity} style={{'--guide-rarity':rarityColor[info.rarity]} as CSSProperties}><span className="combat-effect-dot"/><div><b>{info.rarity} <small>{info.effect}</small></b><p>{info.text}</p></div></article>)}</div></>}
    {topic==='roles'&&<div className="combat-role-guide" data-combat-tutorial="roles"><div className="combat-explainer-heading"><span className="combat-kicker">RÔLES TECHNIQUES</span><small>Six effets distincts : soutien, contrôle, progression et persistance</small></div><div className="combat-role-guide-grid">{COMBAT_ROLES.map(role=><article key={role.id}><b>{role.module}</b><p>{role.description}</p></article>)}</div></div>}
    {topic==='incidents'&&<div className="combat-weather-guide"><div className="combat-explainer-heading"><span className="combat-kicker">INCIDENTS SYSTÈME</span><small>Un incident est tiré au hasard au début de chaque manche</small></div>{weatherGuide.map(([id,name,effect])=>{const Icon=weatherIcon[id];return <div className={`combat-weather-guide-row weather-${id}`} key={id}><Icon size={13}/><b>{name}</b><span>{effect}</span></div>})}<p>Panne thermique = Client, latence = Réseau, surcharge = Serveur. Les cartes touchées passent à 1 point ; les Légendaires ignorent l’incident.</p></div>}
  </section>;
}

function CombatRulebookDialog({theme,onClose,initialTopic='cards'}:{theme:'dark'|'light';onClose:()=>void;initialTopic?:RulebookTopic}){
  const [topic,setTopic]=useState<RulebookTopic>(initialTopic);
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[onClose]);
  const heading=rulebookTopics.find(item=>item.id===topic)?.label??'Règles & effets';
  return createPortal(<div className="app-shell combat-portal-shell" data-theme={theme}><div className="combat-rulebook-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><section className="combat-rulebook-dialog" role="dialog" aria-modal="true" aria-labelledby="combat-rulebook-title"><header><div><span className="combat-kicker">MÉMO DE L’ARÈNE</span><h2 id="combat-rulebook-title">{heading}</h2></div><button type="button" onClick={onClose} aria-label="Fermer le rappel des règles"><X size={19}/></button></header><nav className="combat-rulebook-tabs" aria-label="Rubriques des règles">{rulebookTopics.map(({id,label,Icon})=><button key={id} type="button" role="tab" aria-selected={topic===id} className={topic===id?'active':''} onClick={()=>setTopic(id)}><Icon size={14}/>{label}</button>)}</nav><div className="combat-rulebook-scroll"><CombatRulebookContent topic={topic}/></div></section></div></div>,document.body);
}

function DeckPoolCard({card,chosen,onToggle,theme}:{card:OwnedCard;chosen:boolean;onToggle:()=>void;theme:'dark'|'light'}){
  const [inspection,setInspection]=useState<{left:number;top:number;width:number}|null>(null);
  const closeTimer=useRef<number|null>(null);
  const role=getCombatRoleInfo(getCombatProfile(card)),rarity=rarityClass[card.rarity]??'common';
  const showInspection=(element:HTMLElement)=>{
    if(closeTimer.current!==null)window.clearTimeout(closeTimer.current);
    const rect=element.getBoundingClientRect(),width=Math.min(480,window.innerWidth-24),height=300;
    const left=Math.min(Math.max(12,rect.left),window.innerWidth-width-12);
    const top=window.innerHeight-rect.bottom>height+18?rect.bottom+9:Math.max(12,rect.top-height-9);
    setInspection({left,top,width});
  };
  const scheduleClose=()=>{if(closeTimer.current!==null)window.clearTimeout(closeTimer.current);closeTimer.current=window.setTimeout(()=>setInspection(null),180)};
  useEffect(()=>()=>{if(closeTimer.current!==null)window.clearTimeout(closeTimer.current)},[]);
  const tooltipId=`combat-deck-tip-${card.id}-${card.isShiny?'shiny':'normal'}`;
  return <>
    <button type="button" className={`combat-pool-card ${rarity}${chosen?' selected':''}${card.isShiny?' shiny':''}`} onClick={onToggle} onMouseEnter={event=>showInspection(event.currentTarget)} onMouseLeave={scheduleClose} onFocus={event=>showInspection(event.currentTarget)} onBlur={()=>setInspection(null)} aria-pressed={chosen} aria-describedby={inspection?tooltipId:undefined} aria-label={`${card.name}, ${fullCombatExplanation(card)}`}>
      <span className="combat-pool-art">{card.imageUrl?<img src={card.imageUrl} alt="" loading="lazy"/>:<i>◈</i>}{card.isShiny&&<b className="combat-shiny-mark">✦</b>}{chosen&&<b className="combat-chosen-mark"><Check size={12}/></b>}</span>
      <span className="combat-pool-meta"><strong>{card.name}</strong><small>{card.setName}</small><em>{card.rarity} · {RARITY_EFFECT[card.rarity]??'Aucun effet'}</em><small className="combat-role-label">{role.module}</small></span><b className="combat-pool-power">{getCombatBasePower(card)}</b>
    </button>
    {inspection&&createPortal(<CombatCardEffectOverlay id={tooltipId} card={card} theme={theme} style={{left:inspection.left,top:inspection.top,width:inspection.width,maxHeight:'calc(100vh - 24px)',overflowY:'auto'}} onMouseEnter={()=>{if(closeTimer.current!==null)window.clearTimeout(closeTimer.current)}} onMouseLeave={()=>setInspection(null)}/>,document.body)}
  </>;
}

export default function CombatArena({user,onLogin,view='combat',onNavigateToDeck,theme='dark'}:Props){
  const [cards,setCards]=useState<OwnedCard[]>([]);
  const [players,setPlayers]=useState<PlayerOption[]>([]);
  const [matches,setMatches]=useState<MatchSummary[]>([]);
  const [matchRecord,setMatchRecord]=useState<MatchRecord>({played:0,wins:0});
  const [selectedDeck,setSelectedDeck]=useState<string[]>([]);
  const [savedDecks,setSavedDecks]=useState<SavedCombatDeck[]>([]);
  const [selectedSavedDeckId,setSelectedSavedDeckId]=useState('');
  const [deckName,setDeckName]=useState('');
  const [editingDeckId,setEditingDeckId]=useState<string|null>(null);
  const [deckSaving,setDeckSaving]=useState(false);
  const [selectedMode,setSelectedMode]=useState<'ai'|'pvp'>('ai');
  const [opponentId,setOpponentId]=useState('');
  const [opponentSearch,setOpponentSearch]=useState('');
  const [cardSearch,setCardSearch]=useState('');
  const [deckRarityFilter,setDeckRarityFilter]=useState('all');
  const [deckRoleFilter,setDeckRoleFilter]=useState('all');
  const [deckSeriesFilter,setDeckSeriesFilter]=useState('all');
  const [activeMatchId,setActiveMatchId]=useState<string|null>(null);
  const [activeMatch,setActiveMatch]=useState<MatchDetail|null>(null);
  const [battle,setBattle]=useState<BattleState|null>(null);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [pageError,setPageError]=useState('');
  const [notice,setNotice]=useState('');
  const [selectedHandCard,setSelectedHandCard]=useState<string|null>(null);
  const [impact,setImpact]=useState('');
  const [soundOn,setSoundOn]=useState(true);
  const [tutorialOpen,setTutorialOpen]=useState(false);
  const [rulesOpen,setRulesOpen]=useState(false);
  const [turnAnnouncement,setTurnAnnouncement]=useState<TurnAnnouncement|null>(null);
  const lastHistoryLength=useRef(0);
  const aiSequenceRef=useRef(false);
  const battleRef=useRef<BattleState|null>(battle);
  battleRef.current=battle;
  const soundRef=useRef<AudioContext|null>(null);

  const selectedCards=useMemo(()=>cards.filter(card=>selectedDeck.includes(keyOf(card))),[cards,selectedDeck]);
  const orderedPreviewCards=useMemo(()=>[...selectedCards].sort((a,b)=>(combatRarityOrder[a.rarity]??99)-(combatRarityOrder[b.rarity]??99)||a.name.localeCompare(b.name,'fr',{sensitivity:'base'})),[selectedCards]);
  const deckRaritySlots=useMemo(()=>['Commune','Peu commune','Rare','Épique','Légendaire','Secrète'].map(rarity=>({rarity,count:selectedCards.filter(card=>card.rarity===rarity).length,limited:limitRarities.includes(rarity)})),[selectedCards]);
  const selectedSavedDeck=useMemo(()=>savedDecks.find(deck=>deck.id===selectedSavedDeckId)??null,[savedDecks,selectedSavedDeckId]);
  const deckIssue=useMemo(()=>{
    if(view==='combat'&&selectedSavedDeck){const missing=selectedSavedDeck.cards.filter(ref=>!cards.some(card=>keyOf(card)===`${ref.cardId}:${ref.isShiny?1:0}`)).length;if(missing>0)return `${missing} carte${missing===1?'':'s'} de ce deck ne sont plus dans ta collection. Modifie-le avant de lancer le combat.`}
    if(selectedCards.length<8)return 'Sélectionne au moins 8 cartes.';
    if(selectedCards.length>12)return 'Ton deck est limité à 12 cartes.';
    for(const rarity of limitRarities)if(selectedCards.filter(card=>card.rarity===rarity).length>1)return `Une seule carte ${rarity.toLowerCase()} maximum.`;
    return '';
  },[selectedCards]);
  const deckSeries=useMemo(()=>[...new Set(cards.map(card=>card.setName).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr')),[cards]);
  const filteredCards=useMemo(()=>cards.filter(card=>{
    const profile=getCombatProfile(card);
    const role=getCombatRoleInfo(profile);
    return (deckRarityFilter==='all'||card.rarity===deckRarityFilter)
      &&(deckRoleFilter==='all'||profile.role===deckRoleFilter)
      &&(deckSeriesFilter==='all'||card.setName===deckSeriesFilter)
      &&normalize(`${card.name} ${card.setName} ${card.category} ${role.module}`).includes(normalize(cardSearch));
  }),[cards,cardSearch,deckRarityFilter,deckRoleFilter,deckSeriesFilter]);
  const filteredPlayers=useMemo(()=>players.filter(player=>normalize(player.username).includes(normalize(opponentSearch))),[players,opponentSearch]);

  const loadLobby=useCallback(async()=>{
    if(!user)return;
    try{
      const response=await fetch('/api/combat',{credentials:'same-origin',cache:'no-store'});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error??'Impossible de charger l’arène.');
      const ownedRows=(data.cards??[]).filter((card:RawCard)=>Number(card.quantity)>0);
      const loaded=ownedRows.map((card:RawCard)=>{
        const combatProfile=card.role_id&&card.combat_power!==null&&card.combat_power!==undefined&&card.stability!==null&&card.stability!==undefined&&card.expertise!==null&&card.expertise!==undefined
          ? {role:card.role_id,power:card.combat_power,stability:card.stability,expertise:card.expertise}:undefined;
        return {id:card.id,name:card.name,rarity:card.rarity,category:card.category,setId:card.set_id,setName:card.set_name,imageUrl:card.image_url,isShiny:Boolean(card.is_shiny),quantity:card.quantity,combatProfile:getCombatProfile({id:card.id,combatProfile})} as OwnedCard;
      });
      setCards(loaded);setPlayers(data.players??[]);setMatches(data.matches??[]);setMatchRecord(data.matchRecord??{played:0,wins:0});setSavedDecks((data.decks??[]) as SavedCombatDeck[]);
      setSelectedDeck(current=>current.filter(key=>loaded.some((card:OwnedCard)=>keyOf(card)===key)));
    }catch(error){setPageError(error instanceof Error?error.message:'Impossible de charger l’arène.')}
  },[user]);

  const loadMatch=useCallback(async(id:string)=>{
    try{
      const response=await fetch(`/api/combat/${encodeURIComponent(id)}`,{credentials:'same-origin',cache:'no-store'});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error??'Impossible de reprendre le combat.');
      setActiveMatch(data.match??null);const nextState=(data.state??null) as BattleState|null;const played=newlyPlacedCard(battleRef.current,nextState);if(played&&played.power>=7)setImpact('heavy');battleRef.current=nextState;setBattle(nextState);
      const historyLength=data.state?.history?.length??0;if(historyLength>lastHistoryLength.current)setImpact('round');lastHistoryLength.current=historyLength;
    }catch(error){setPageError(error instanceof Error?error.message:'Impossible de reprendre le combat.')}
  },[]);

  useEffect(()=>{if(!user){setCards([]);setMatches([]);setMatchRecord({played:0,wins:0});return}setLoading(true);void loadLobby().finally(()=>setLoading(false));const timer=window.setInterval(()=>void loadLobby(),5000);return()=>window.clearInterval(timer)},[user?.id,loadLobby]);
  useEffect(()=>{if(view!=='combat')return;setSelectedSavedDeckId(current=>current&&savedDecks.some(deck=>deck.id===current)?current:savedDecks[0]?.id??'')},[view,savedDecks]);
  useEffect(()=>{if(view!=='combat')return;setSelectedDeck(selectedSavedDeck?.cards.map(ref=>`${ref.cardId}:${ref.isShiny?1:0}`)??[])},[view,selectedSavedDeck]);
  useEffect(()=>{if(!activeMatchId||!user)return;void loadMatch(activeMatchId);if(activeMatch?.status==='finished')return;const timer=window.setInterval(()=>{if(!aiSequenceRef.current)void loadMatch(activeMatchId)},2400);return()=>window.clearInterval(timer)},[activeMatchId,activeMatch?.status,user?.id,loadMatch]);
  useEffect(()=>{if(!impact)return;const timer=window.setTimeout(()=>setImpact(''),impact==='round'?1300:impact==='heavy'?850:650);return()=>window.clearTimeout(timer)},[impact]);
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(''),4000);return()=>window.clearTimeout(timer)},[notice]);

  function playSound(kind:'play'|'effect'|'win'|'storm'){
    if(!soundOn||typeof window==='undefined')return;
    try{
      const AudioContextConstructor=window.AudioContext;
      if(!AudioContextConstructor)return;
      const context=soundRef.current??new AudioContextConstructor();soundRef.current=context;
      if(context.state==='suspended')void context.resume().catch(()=>{});
      const now=context.currentTime,osc=context.createOscillator(),gain=context.createGain();
      const tones=kind==='win'?[523.25,659.25,783.99]:kind==='effect'?[220,392]:kind==='storm'?[92,48]:[210,330];
      osc.type=kind==='storm'?'sawtooth':'triangle';osc.frequency.setValueAtTime(tones[0],now);
      if(tones.length>1)osc.frequency.exponentialRampToValueAtTime(tones[1],now+(kind==='storm'?.24:.13));
      gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(kind==='storm'?.11:.07,now+.018);gain.gain.exponentialRampToValueAtTime(.0001,now+(kind==='win'?.42:.25));
      osc.connect(gain);gain.connect(context.destination);osc.start(now);osc.stop(now+(kind==='win'?.44:.28));
    }catch{}
  }

  function toggleDeck(card:OwnedCard){
    const key=keyOf(card);setPageError('');
    setSelectedDeck(current=>{
      if(current.includes(key))return current.filter(item=>item!==key);
      if(current.length>=12){setPageError('Un deck peut contenir 12 cartes maximum.');return current}
      if(current.some(selected=>cards.find(item=>keyOf(item)===selected)?.id===card.id)){setPageError('La même carte ne peut entrer qu’une fois dans le deck, même en version Shiny.');return current}
      if(limitRarities.includes(card.rarity)&&cards.find(item=>current.includes(keyOf(item))&&item.rarity===card.rarity)){setPageError(`Une seule carte ${card.rarity.toLowerCase()} peut entrer dans le deck.`);return current}
      return [...current,key];
    });
  }

  function beginEditingDeck(deck:SavedCombatDeck){setEditingDeckId(deck.id);setDeckName(deck.name);setSelectedDeck(deck.cards.map(ref=>`${ref.cardId}:${ref.isShiny?1:0}`));setPageError('');}
  function beginNewDeck(){setEditingDeckId(null);setDeckName('');setSelectedDeck([]);setPageError('');}
  function selectSavedDeck(id:string){setSelectedSavedDeckId(id);const deck=savedDecks.find(item=>item.id===id);setSelectedDeck(deck?.cards.map(ref=>`${ref.cardId}:${ref.isShiny?1:0}`)??[]);setPageError('');}

  async function saveDeck(){
    if(!deckName.trim()){setPageError('Donne un nom à ce deck.');return}
    if(deckIssue){setPageError(deckIssue);return}
    setDeckSaving(true);setPageError('');
    try{
      const cards=selectedCards.map(card=>({cardId:card.id,isShiny:card.isShiny}));
      const response=await fetch(editingDeckId?`/api/combat/decks/${encodeURIComponent(editingDeckId)}`:'/api/combat/decks',{method:editingDeckId?'PUT':'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({name:deckName,cards})});
      const data=await response.json();if(!response.ok)throw new Error(data.error??'Impossible d’enregistrer le deck.');
      const saved=data.deck as SavedCombatDeck;
      setSavedDecks(current=>editingDeckId?current.map(deck=>deck.id===saved.id?saved:deck):[saved,...current]);
      setEditingDeckId(saved.id);setDeckName(saved.name);setNotice('Deck enregistré. Tu pourras le choisir dans l’onglet Combat.');
    }catch(error){setPageError(error instanceof Error?error.message:'Impossible d’enregistrer le deck.')}
    finally{setDeckSaving(false)}
  }

  async function deleteSavedDeck(deck:SavedCombatDeck){
    if(!window.confirm(`Supprimer le deck « ${deck.name} » ?`))return;
    setDeckSaving(true);setPageError('');
    try{
      const response=await fetch(`/api/combat/decks/${encodeURIComponent(deck.id)}`,{method:'DELETE',credentials:'same-origin'});const data=await response.json();if(!response.ok)throw new Error(data.error??'Impossible de supprimer le deck.');
      setSavedDecks(current=>current.filter(item=>item.id!==deck.id));if(editingDeckId===deck.id)beginNewDeck();if(selectedSavedDeckId===deck.id){setSelectedSavedDeckId('');setSelectedDeck([])}
    }catch(error){setPageError(error instanceof Error?error.message:'Impossible de supprimer le deck.')}
    finally{setDeckSaving(false)}
  }

  async function createCombat(){
    if(!user){onLogin();return}
    if(selectedMode==='pvp'){setPageError('Le combat entre joueurs est temporairement inaccessible.');return}
    setPageError('');setBusy(true);
    try{
      const body={mode:'ai',cards:selectedCards.map(card=>({cardId:card.id,isShiny:card.isShiny}))};
      const response=await fetch('/api/combat',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok)throw new Error(data.error??'Impossible de lancer le combat.');
      setNotice('Le Daemon accepte le défi. À toi de jouer.');
      setActiveMatchId(data.id);
    }catch(error){setPageError(error instanceof Error?error.message:'Impossible de lancer le combat.')}
    finally{setBusy(false)}
  }

  async function matchAction(id:string,action:Record<string,unknown>,success?:string,options:{manageBusy?:boolean;refreshLobby?:boolean;previousState?:BattleState}={}):Promise<BattleState|null>{
    const manageBusy=options.manageBusy!==false;
    setPageError('');if(manageBusy)setBusy(true);
    try{
      const response=await fetch(`/api/combat/${encodeURIComponent(id)}`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(action)});
      const data=await response.json();if(!response.ok)throw new Error(data.error??'Action impossible.');
      if(data.state){const nextState=data.state as BattleState;const previousState=options.previousState??battleRef.current;const played=newlyPlacedCard(previousState,nextState);if(played&&played.power>=7)setImpact('heavy');battleRef.current=nextState;setActiveMatchId(id);setBattle(nextState);setActiveMatch(current=>current?{...current,status:data.status??nextState.status}:current);if(nextState.status==='finished'&&nextState.winner===nextState.viewer)playSound('win');if(options.refreshLobby!==false)await loadLobby();return nextState}
      else if(data.status==='active'){setActiveMatchId(id);setNotice('Défi accepté. Les canaux s’ouvrent.');}
      else if(success)setNotice(success);
      if(options.refreshLobby!==false)await loadLobby();
    }catch(error){setPageError(error instanceof Error?error.message:'Action impossible.')}
    finally{if(manageBusy)setBusy(false)}
    return null;
  }

  async function announceRoundResults(results:BattleState['history'],state:BattleState){
    for(const result of results){
      const outcome=result.winner==='draw'?'draw':result.winner===state.viewer?'win':'loss';
      const title=outcome==='win'?'Manche gagnée ! Bravo !':outcome==='draw'?'Manche nulle':'Manche perdue';
      setImpact('round');
      setTurnAnnouncement({kind:'round',outcome,title});
      await wait(1600);
      setTurnAnnouncement(null);
    }
  }

  async function runDaemonReplies(id:string,initialState:BattleState){
    let current=initialState,safety=0;
    while(current.status==='active'&&current.turn==='p2'&&safety++<12){
      const priorHistoryLength=current.history.length,priorLogId=current.log.at(-1)?.id??0;
      setTurnAnnouncement({kind:'daemon',title:'Le Daemon prépare son coup',detail:'Il choisit une carte et un canal…'});
      await wait(1150);
      const next=await matchAction(id,{action:'daemon'},undefined,{manageBusy:false,refreshLobby:false,previousState:current});
      if(!next)return;
      const justPlayed=newlyPlacedCard(current,next);
      current=next;
      const resolvedRounds=current.history.slice(priorHistoryLength);
      if(resolvedRounds.length){
        if(justPlayed&&justPlayed.power>=7)await wait(800);
        await announceRoundResults(resolvedRounds,current);
      }else{
        const played=[...current.log].reverse().find(line=>line.id>priorLogId&&line.kind==='play');
        if(played){playSound('play');setTurnAnnouncement({kind:'daemon-play',title:'Le Daemon joue',detail:played.text});await wait(500)}
        setTurnAnnouncement(null);
        await wait(850);
      }
      setTurnAnnouncement(null);
      if(current.status==='finished'){
        const outcome=current.winner==='draw'?'draw':current.winner===current.viewer?'win':'loss';
        setTurnAnnouncement({kind:'match',outcome,title:outcome==='win'?'Partie gagnée ! Bravo !':outcome==='draw'?'Partie nulle':'Partie perdue'});
        await wait(1650);setTurnAnnouncement(null);return;
      }
    }
    if(current.status==='active'&&current.turn===current.viewer&&!current.passed.includes(current.viewer)){
      setTurnAnnouncement({kind:'your-turn',title:'À toi de jouer',detail:'Choisis ta prochaine carte et son canal.'});
      await wait(1150);setTurnAnnouncement(null);
    }
  }

  async function runPlayerAction(action:Record<string,unknown>){
    if(!activeMatchId)return;
    const previousState=battleRef.current;
    if(battle?.mode!=='ai'){
      const state=await matchAction(activeMatchId,action,undefined,{previousState:previousState??undefined});
      if(state&&previousState&&state.history.length>previousState.history.length)await announceRoundResults(state.history.slice(previousState.history.length),state);
      return;
    }
    aiSequenceRef.current=true;setBusy(true);
    try{
      const state=await matchAction(activeMatchId,action,undefined,{manageBusy:false,refreshLobby:false,previousState:previousState??undefined});
      if(!state)return;
      if(previousState&&state.history.length>previousState.history.length)await announceRoundResults(state.history.slice(previousState.history.length),state);
      if(state.status==='active'&&state.turn==='p2'){
        await wait(850);
        await runDaemonReplies(activeMatchId,state);
      }else if(state.status==='finished'){
        const outcome=state.winner==='draw'?'draw':state.winner===state.viewer?'win':'loss';
        setTurnAnnouncement({kind:'match',outcome,title:outcome==='win'?'Partie gagnée ! Bravo !':outcome==='draw'?'Partie nulle':'Partie perdue'});
        await wait(1200);setTurnAnnouncement(null);
      }
    }finally{aiSequenceRef.current=false;setBusy(false);setTurnAnnouncement(null)}
  }

  async function playCard(card:CombatCard,row:CombatRow){
    if(!activeMatchId)return;
    setSelectedHandCard(null);setImpact(card.rarity==='Secrète'?'secret':'play');playSound(card.rarity==='Secrète'?'effect':'play');
    await runPlayerAction({action:'play',cardId:card.id,row});
  }

  async function passRound(){
    if(!activeMatchId)return;
    playSound('play');await runPlayerAction({action:'pass'});
  }

  const pendingIncoming=matches.filter(match=>match.status==='waiting'&&match.player2_id===user?.id);
  const pendingOutgoing=matches.filter(match=>match.status==='waiting'&&match.player1_id===user?.id);
  const liveMatches=matches.filter(match=>match.status==='active').slice(0,3);
  const recentMatches=matches.filter(match=>['finished','declined','cancelled'].includes(match.status));

  if(!user)return <section className="combat-page"><div className="combat-login-card"><div className="combat-orbit"><Swords size={44}/><i/><b/></div><span className="combat-kicker">ARÈNE DU CAMPUS_</span><h2>Le champ de bataille t’attend.</h2><p>Construis ton deck, lis la météo et remporte deux manches sur trois.</p><button type="button" className="button primary" onClick={onLogin}>Se connecter pour combattre</button></div></section>;

  function exitBattle(){setActiveMatchId(null);setActiveMatch(null);setBattle(null);setPageError('');setTurnAnnouncement(null);void loadLobby()}
  if(activeMatchId&&activeMatch&&battle){
    const battleScreen=<div className="app-shell combat-portal-shell" data-theme={theme}><BattleArena state={battle} match={activeMatch} busy={busy} error={pageError} impact={impact} soundOn={soundOn} theme={theme} turnAnnouncement={turnAnnouncement} onToggleSound={()=>setSoundOn(value=>!value)} onStorm={()=>playSound('storm')} onPlay={playCard} onPass={activeMatch.status==='active'?passRound:()=>{}} onExit={exitBattle}/></div>;
    return typeof document==='undefined'?battleScreen:createPortal(battleScreen,document.body);
  }

  return <section className="combat-page">
    <header className="combat-heading"><div><span className="combat-kicker"><Swords size={13}/> ESPACE JOUEUR · {view==='decks'?'ARSENAL':'COMBAT'}</span><h2>{view==='decks'?<>Prépare tes <em>decks</em></>:<>Arène du <em>campus</em></>}</h2><p>{view==='decks'?'Compose et enregistre tes decks ici, puis sélectionne-les dans l’onglet Combat.':'Choisis un deck préparé, puis défie le Daemon. Les duels joueurs sont momentanément indisponibles.'}</p></div>{view==='combat'&&<div className="combat-heading-actions"><button type="button" className="combat-text-button combat-tutorial-toggle" onClick={()=>setTutorialOpen(true)}><BookOpen size={15}/>Tutoriel pas à pas</button></div>}</header>

    <div className={`combat-lobby-layout${view==='combat'?' combat-match-setup':''}`}>
      {view==='decks'?<>
      <div className="combat-deck-panel" data-combat-tutorial="deck">
        <div className="combat-panel-title"><div><span className="combat-kicker">TON ARSENAL</span><h3>Prépare ton deck</h3></div><div className={'combat-deck-count'+(deckIssue?' is-incomplete':'')}><strong>{selectedCards.length}</strong><span>/ 12</span></div></div>
        <div className="combat-deck-meter"><i style={{width:`${Math.min(100,selectedCards.length/12*100)}%`}}/></div>
        <div className="combat-rarity-capacity" aria-label="Nombre de cartes sélectionnées par rareté">{deckRaritySlots.map(({rarity,count,limited})=><div className={`combat-rarity-slot ${rarityClass[rarity]??'common'}${count>0?' has-cards':''}${limited&&count===1?' is-full':''}`} key={rarity} style={{'--rarity':rarityColor[rarity]} as CSSProperties}><span>{rarity}</span><strong>{limited?`${count} / 1`:count}</strong><small>{limited?'MAX. 1':'SANS LIMITE'}</small></div>)}</div>
        <label className="combat-card-search"><Search size={15}/><input value={cardSearch} onChange={event=>setCardSearch(event.target.value)} placeholder="Chercher dans ta collection…" aria-label="Chercher une carte pour le deck"/></label>
        <div className="combat-deck-filters" aria-label="Filtres des cartes du deck">
          <label><span>RARETÉ</span><select value={deckRarityFilter} onChange={event=>setDeckRarityFilter(event.target.value)} aria-label="Filtrer les cartes par rareté"><option value="all">Toutes les raretés</option>{rarityGuide.map(({rarity})=><option key={rarity} value={rarity}>{rarity}</option>)}</select></label>
          <label><span>RT · RÔLE TECHNIQUE</span><select value={deckRoleFilter} onChange={event=>setDeckRoleFilter(event.target.value)} aria-label="Filtrer les cartes par rôle technique"><option value="all">Tous les rôles</option>{COMBAT_ROLES.map(role=><option key={role.id} value={role.id}>{role.module}</option>)}</select></label>
          <label><span>SÉRIE</span><select value={deckSeriesFilter} onChange={event=>setDeckSeriesFilter(event.target.value)} aria-label="Filtrer les cartes par série"><option value="all">Toutes les séries</option>{deckSeries.map(series=><option key={series} value={series}>{series}</option>)}</select></label>
        </div>
        {loading?<div className="combat-empty"><LoaderCircle className="spin"/>Lecture de la collection…</div>:cards.length===0?<div className="combat-empty"><Sparkles/><strong>Ton arsenal est encore vide.</strong><span>Ouvre quelques boosters et reviens composer ton premier deck.</span></div>:<div className="combat-card-pool" data-combat-tutorial="cards">{filteredCards.map(card=>{
          const key=keyOf(card),chosen=selectedDeck.includes(key);
          return <DeckPoolCard key={key} card={card} chosen={chosen} theme={theme} onToggle={()=>toggleDeck(card)}/>
        })}</div>}
        <div className="combat-selected-strip"><div className="combat-selected-heading"><span>COMPOSITION</span><span>{selectedCards.length<8?`${8-selectedCards.length} cartes restantes minimum`:deckIssue||'Deck prêt'}</span></div><div className="combat-selected-list">{selectedCards.map(card=><button type="button" key={keyOf(card)} title={`Retirer ${card.name}`} onClick={()=>toggleDeck(card)}><span style={{'--combat-rarity':rarityColor[card.rarity]} as React.CSSProperties}>{card.isShiny?'✦ ':''}{card.name}</span><X size={12}/></button>)}{selectedCards.length===0&&<small>Sélectionne les cartes que tu veux engager.</small>}</div></div>
      </div>
      <aside className="combat-launch-panel combat-saved-deck-manager"><div className="combat-launch-sparks" aria-hidden="true"><i/><i/><i/><i/></div><span className="combat-kicker">ATELIER DE DECKS · {savedDecks.length} / 12</span><h3>{editingDeckId?'Modifier le deck':'Enregistrer un deck'}</h3><label className="combat-deck-name-field"><span>Nom du deck</span><input value={deckName} maxLength={32} onChange={event=>setDeckName(event.target.value)} placeholder="Ex. Contrôle des canaux"/></label>{pageError&&<div className="combat-error" role="alert">{pageError}</div>}{notice&&<div className="combat-notice" role="status">{notice}</div>}<button type="button" className="combat-launch-button" onClick={()=>void saveDeck()} disabled={deckSaving||Boolean(deckIssue)||!deckName.trim()}><span>{deckSaving?<LoaderCircle size={17} className="spin"/>:<Check size={17}/>}<span>{editingDeckId?'Mettre à jour le deck':'Enregistrer le deck'}</span></span></button><button type="button" className="combat-text-button combat-new-deck-button" onClick={beginNewDeck} disabled={deckSaving}>Nouveau deck</button><div className="combat-saved-deck-list"><div className="combat-explainer-heading"><span className="combat-kicker">TES DECKS ENREGISTRÉS</span><small>Garde jusqu’à 12 compositions</small></div>{savedDecks.length===0?<div className="combat-empty"><Layers/><span>Enregistre ton premier deck pour le retrouver dans Combat.</span></div>:savedDecks.map(deck=><article className="combat-saved-deck-item" key={deck.id}><div><strong>{deck.name}</strong><small>{deck.cards.length} cartes · modifié {new Date(deck.updatedAt).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}</small></div><button type="button" className="combat-deck-edit-button" onClick={()=>beginEditingDeck(deck)} disabled={deckSaving}>Modifier</button><button type="button" className="combat-deck-delete-button" onClick={()=>void deleteSavedDeck(deck)} disabled={deckSaving} aria-label={`Supprimer ${deck.name}`}><X size={14}/></button></article>)}</div><div className="combat-launch-foot"><span><i/> SAUVEGARDÉ SUR TON COMPTE</span><span>UTILISABLE SUR TES PROCHAINS DUELS</span></div></aside>
      </>:<>
      <div className="combat-deck-panel combat-selected-deck-panel" data-combat-tutorial="deck"><div className="combat-panel-title"><div><span className="combat-kicker">TON ARSENAL</span><h3>Choisis ton deck</h3></div><button type="button" className="combat-deck-edit-button" onClick={onNavigateToDeck}>Gérer</button></div>{loading&&savedDecks.length===0?<div className="combat-empty"><LoaderCircle className="spin"/>Chargement de tes decks…</div>:savedDecks.length===0?<div className="combat-no-deck"><div className="combat-orbit compact"><Layers size={30}/><i/><b/></div><h3>Aucun deck sélectionné</h3><p>Prépare un deck de 8 à 12 cartes avant de lancer un combat.</p><button type="button" className="combat-launch-button" onClick={onNavigateToDeck}><span><Layers/>Créer ton deck</span><ChevronRight size={19}/></button></div>:<><label className="combat-saved-deck-select"><span>DECK POUR CE COMBAT</span><select value={selectedSavedDeckId} onChange={event=>selectSavedDeck(event.target.value)} aria-label="Choisir un deck enregistré">{savedDecks.map(deck=><option key={deck.id} value={deck.id}>{deck.name} · {deck.cards.length} cartes</option>)}</select></label>{selectedSavedDeck&&<><div className="combat-selected-deck-summary"><div><strong>{selectedSavedDeck.name}</strong><span>{selectedCards.length} / {selectedSavedDeck.cards.length} cartes disponibles dans ta collection</span></div><div className="combat-deck-meter"><i style={{width:`${Math.min(100,selectedCards.length/12*100)}%`}}/></div>{deckIssue&&<p className="combat-deck-warning">{deckIssue} <button type="button" onClick={()=>onNavigateToDeck?.()}>Modifie ce deck</button></p>}<div className="combat-picked-card-list" aria-label="Illustrations du deck, de la rareté la plus élevée à la plus basse">{orderedPreviewCards.map(card=><span className={rarityClass[card.rarity]??'common'} key={keyOf(card)} aria-label={`Carte ${card.rarity}`} role="img">{card.imageUrl&&<img src={card.imageUrl} alt="" loading="lazy"/>}</span>)}</div></div><button type="button" className="combat-text-button combat-edit-deck-link" onClick={onNavigateToDeck}>Modifier mes decks</button></>}</>}<p className="combat-deck-policy"><Shield size={14}/> Les compositions restent enregistrées sur ton compte. Tu peux en préparer plusieurs et les choisir ici.</p></div>
      </>}

      {view==='combat'&&<aside className="combat-launch-panel" data-combat-tutorial="launch"><div className="combat-launch-sparks" aria-hidden="true"><i/><i/><i/><i/></div><span className="combat-kicker">CHOISIS TON ADVERSAIRE</span><h3>Quel nœud défier ?</h3><div className="combat-mode-picker"><button type="button" className={selectedMode==='ai'?'selected':''} onClick={()=>setSelectedMode('ai')}><Bot size={18}/><span>Daemon du campus<small>Processus autonome</small></span>{selectedMode==='ai'&&<Check size={15}/>}</button><button type="button" className="is-inaccessible" disabled aria-label="Nœud joueur, inaccessible pour le moment" title="Inaccessible pour le moment"><Users size={18}/><span>Nœud joueur<small>Inaccessible pour le moment</small></span><em className="combat-unavailable-tag">INDISPONIBLE</em></button></div>
        {selectedMode==='pvp'&&<div className="combat-opponent-picker"><label><Search size={14}/><input value={opponentSearch} onChange={event=>setOpponentSearch(event.target.value)} placeholder="Rechercher un joueur…"/></label><select value={opponentId} onChange={event=>setOpponentId(event.target.value)} aria-label="Joueur à défier"><option value="">Choisir un joueur</option>{filteredPlayers.map(player=><option key={player.id} value={player.id}>{player.username}</option>)}</select></div>}
        {pageError&&<div className="combat-error" role="alert">{pageError}</div>}{notice&&<div className="combat-notice" role="status">{notice}</div>}
        <button type="button" className="combat-launch-button" data-combat-tutorial="launch-button" onClick={()=>void createCombat()} disabled={busy||Boolean(deckIssue)||selectedMode==='pvp'&&!opponentId}><span>{busy?<LoaderCircle className="spin"/>:<Swords/>}{selectedMode==='ai'?'Entrer dans l’arène':'Envoyer le défi'}</span><ChevronRight size={19}/></button>
        <button type="button" className="combat-text-button combat-rulebook-launch" data-combat-tutorial="rules-button" onClick={()=>setRulesOpen(true)}><BookOpen size={15}/>Règles & effets</button>
        <div className="combat-launch-foot"><span><i/> COMBAT SANS MISE</span><span>LES CARTES RESTENT DANS TA COLLECTION</span></div>
      </aside>}
    </div>

    {view==='combat'&&(pendingIncoming.length>0||pendingOutgoing.length>0||liveMatches.length>0||recentMatches.length>0)&&<section className="combat-match-list"><div className="combat-panel-title"><div><span className="combat-kicker">TABLEAU DES DUELS</span><h3>Combats en cours</h3></div><div className="combat-match-metrics">{matchRecord.played>0&&<span className="combat-win-record"><Trophy size={13}/><b>{matchRecord.wins}/{matchRecord.played}</b> victoires · {Math.round(matchRecord.wins/matchRecord.played*100)} %</span>}<span className="combat-live-count"><i/> {liveMatches.length} ACTIF{liveMatches.length===1?'':'S'}</span></div></div>
      {pendingIncoming.map(match=><article className="combat-match-item incoming" key={match.id}><div className="combat-match-icon"><Swords/></div><div className="combat-match-info"><b>{match.player1_name} te défie</b><small>{match.mode==='pvp'?'Duel joueur inaccessible pour le moment.':'Invitation reçue · choisis ton deck ci-dessus puis accepte.'}</small></div><button type="button" className="combat-accept-button" onClick={()=>void matchAction(match.id,{action:'join',cards:selectedCards.map(card=>({cardId:card.id,isShiny:card.isShiny}))},'Défi accepté.')} disabled={busy||Boolean(deckIssue)||match.mode==='pvp'}>{match.mode==='pvp'?'Inaccessible':'Accepter'} <ChevronRight size={14}/></button><button type="button" className="combat-decline-button" onClick={()=>void matchAction(match.id,{action:'decline'})} disabled={busy} aria-label="Refuser le défi"><X size={15}/></button></article>)}
      {pendingOutgoing.map(match=><article className="combat-match-item" key={match.id}><div className="combat-match-icon waiting"><LoaderCircle className="spin"/></div><div className="combat-match-info"><b>Défi envoyé à {match.player2_name}</b><small>En attente de sa réponse.</small></div><button type="button" className="combat-text-button" onClick={()=>void matchAction(match.id,{action:'cancel'})} disabled={busy}>Annuler</button></article>)}
      {liveMatches.map(match=><article className="combat-match-item" key={match.id}><div className="combat-match-icon active"><Zap/></div><div className="combat-match-info"><b>{match.mode==='ai'?'Daemon du campus':match.player1_id===user.id?match.player2_name:match.player1_name}</b><small>{match.mode==='ai'?'Processus autonome':`Duel joueur · inaccessible · mis à jour ${new Date(match.updated_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`}</small></div>{match.mode==='ai'?<button type="button" className="combat-accept-button resume" onClick={()=>{setActiveMatchId(match.id);setPageError('')}}>Reprendre <ChevronRight size={14}/></button>:<button type="button" className="combat-accept-button resume" disabled>Inaccessible</button>}</article>)}
      {recentMatches.length>0&&<details className="combat-history-dropdown"><summary><span><Trophy size={14}/> Historique des duels</span><small>{recentMatches.length} récent{recentMatches.length===1?'':'s'} <ChevronRight size={13}/></small></summary><div>{recentMatches.map(match=><article className="combat-match-item completed" key={match.id}><div className="combat-match-icon done"><Trophy/></div><div className="combat-match-info"><b>{match.mode==='ai'?'Daemon du campus':match.player1_id===user.id?match.player2_name:match.player1_name}</b><small>{match.status==='finished'?'Combat terminé':match.status==='declined'?'Défi refusé':'Défi annulé'} · {new Date(match.updated_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}</small></div><span className="combat-status-tag">{match.status==='finished'?'TERMINÉ':match.status==='declined'?'REFUSÉ':'ANNULÉ'}</span></article>)}</div></details>}
    </section>}
    {tutorialOpen&&<GuidedTutorial steps={lobbyTutorial} onClose={()=>setTutorialOpen(false)}/>}
    {rulesOpen&&<CombatRulebookDialog theme={theme} onClose={()=>setRulesOpen(false)}/>}
  </section>;
}

function BattleArena({state,match,busy,error,impact,soundOn,theme,turnAnnouncement,onToggleSound,onStorm,onPlay,onPass,onExit}:{state:BattleState;match:MatchDetail;busy:boolean;error:string;impact:string;soundOn:boolean;theme:'dark'|'light';turnAnnouncement:TurnAnnouncement|null;onToggleSound:()=>void;onStorm:()=>void;onPlay:(card:CombatCard,row:CombatRow)=>void;onPass:()=>void;onExit:()=>void}){
  const [selected,setSelected]=useState<string|null>(null);
  const [draggingCardId,setDraggingCardId]=useState<string|null>(null);
  const [inspectedCardId,setInspectedCardId]=useState<string|null>(null);
  const [handInspection,setHandInspection]=useState<{left:number;top:number;width:number;inline:boolean}|null>(null);
  const inspectionCloseTimer=useRef<number|null>(null);
  const [handCanScroll,setHandCanScroll]=useState({left:false,right:false});
  const handScrollRef=useRef<HTMLDivElement>(null);
  const [tutorialOpen,setTutorialOpen]=useState(false);
  const [rulesOpen,setRulesOpen]=useState(false);
  const lastRound=useRef(state.round);
  useEffect(()=>{if(state.round!==lastRound.current&&state.weather.id==='storm')onStorm();lastRound.current=state.round},[state.round,state.weather.id,onStorm]);
  useEffect(()=>{document.documentElement.classList.add('combat-fullscreen-active');return()=>document.documentElement.classList.remove('combat-fullscreen-active')},[]);
  const updateHandScroll=()=>{const element=handScrollRef.current;if(!element)return;setHandCanScroll({left:element.scrollLeft>2,right:element.scrollLeft+element.clientWidth<element.scrollWidth-2})};
  const showHandInspection=(cardId:string,element:HTMLElement)=>{if(inspectionCloseTimer.current!==null)window.clearTimeout(inspectionCloseTimer.current);const inline=window.matchMedia('(max-width: 780px)').matches,rect=element.getBoundingClientRect(),width=Math.min(480,window.innerWidth-24),height=320,left=Math.min(Math.max(12,rect.left+rect.width/2-width/2),window.innerWidth-width-12),top=Math.max(12,Math.min(rect.top-height+28,window.innerHeight-height-12));setInspectedCardId(cardId);setHandInspection({left,top,width,inline})};
  const scheduleHandInspectionClose=()=>{if(window.matchMedia('(max-width: 780px)').matches)return;if(inspectionCloseTimer.current!==null)window.clearTimeout(inspectionCloseTimer.current);inspectionCloseTimer.current=window.setTimeout(()=>{if(!selected){setInspectedCardId(null);setHandInspection(null)}},220)};
  useEffect(()=>()=>{if(inspectionCloseTimer.current!==null)window.clearTimeout(inspectionCloseTimer.current)},[]);
  useEffect(()=>{const frame=requestAnimationFrame(updateHandScroll);return()=>cancelAnimationFrame(frame)},[state.hand.length]);
  const viewer=state.viewer,enemy:CombatSide=viewer==='p1'?'p2':'p1',myTurn=state.turn===viewer&&!state.passed.includes(viewer)&&state.status==='active';
  const orderedHand=useMemo(()=>[...state.hand].sort((a,b)=>{
    const rarityOrder=(combatRarityOrder[a.rarity]??99)-(combatRarityOrder[b.rarity]??99);
    if(rarityOrder)return rarityOrder;
    const effectOrder=getCombatRoleInfo(getCombatProfile(a)).module.localeCompare(getCombatRoleInfo(getCombatProfile(b)).module,'fr',{sensitivity:'base'});
    if(effectOrder)return effectOrder;
    return getCombatBasePower(b)-getCombatBasePower(a)||a.name.localeCompare(b.name,'fr',{sensitivity:'base'});
  }),[state.hand]);
  const opponentPassed=state.status==='active'&&state.passed.includes(enemy);
  const mine=state.players[viewer],other=state.players[enemy],selectedCard=state.hand.find(card=>card.id===selected)??null;
  const inspectedCard=state.hand.find(card=>card.id===inspectedCardId)??null;
  const WeatherIcon=weatherIcon[state.weather.id];
  const latestEffect=[...state.log].reverse().find(line=>line.kind==='effect')??null;
  return <section className={`combat-page combat-battle-page combat-fullscreen${theme==='light'?' combat-light':''}${impact?' impact-'+impact:''}`}>
    {turnAnnouncement&&<TurnAnnouncementOverlay announcement={turnAnnouncement}/>}
    <div className="combat-battle-toolbar"><span className="combat-live-status"><i/>COMBAT EN DIRECT</span><header className="combat-battle-heading"><div><span className="combat-kicker"><Swords size={13}/> MATCH · DUEL EN COURS</span><h2>{state.mode==='ai'?'Le Daemon':'Duel'} <em>du campus</em></h2></div></header><span className="combat-match-code">{state.mode==='ai'?'ENTRAÎNEMENT IA':'DUEL DU CAMPUS'} · {match.id.slice(0,6).toUpperCase()}</span><div className="combat-battle-tools"><button type="button" className="combat-sound-toggle" onClick={()=>setRulesOpen(true)}><BookOpen size={14}/>Règles</button><button type="button" className="combat-sound-toggle" onClick={()=>setTutorialOpen(true)}><BookOpen size={14}/>Tutoriel</button><button type="button" className="combat-sound-toggle" onClick={onToggleSound} aria-pressed={soundOn}>{soundOn?'SON ON':'SON OFF'}</button><button type="button" className="combat-exit-button" onClick={onExit} aria-label="Quitter l’arène et revenir au menu Combat" title="Quitter l’arène"><X size={19}/><span>Quitter</span></button></div></div>
    {error&&<div className="combat-error" role="alert">{error}</div>}
    {state.status==='finished'&&<div className={`combat-result-banner ${state.winner===viewer?'victory':state.winner==='draw'?'draw':'defeat'}`} role="status"><span className="combat-result-burst"><Trophy size={20}/></span><div><strong>{state.winner===viewer?'Partie gagnée ! Bravo !':state.winner==='draw'?'Partie nulle':'Partie perdue'}</strong></div></div>}
    <div className={`combat-field weather-${state.weather.id}`}>
      <div className="combat-scoreboard">
        <div className="combat-player-score"><span className="combat-player-avatar self">{mine.username[0]?.toUpperCase()??'?'}</span><div><b>{mine.username}</b><small>{state.turn===viewer?'OPÉRATEUR · TON TOUR':state.passed.includes(viewer)?'OPÉRATEUR · EN PAUSE':'OPÉRATEUR · TON NŒUD'}</small></div></div>
        <div className="combat-field-center"><span className="combat-vs">VS</span></div>
        <div className="combat-player-score opponent"><span className="combat-player-avatar">{other.username[0]?.toUpperCase()??'?'}</span><div><b>{other.username}</b><small>{state.mode==='ai'?'PROCESSUS IA':'NŒUD ADVERSE'}</small></div></div>
      </div>
      <div className="combat-turn-track"><span className={state.turn===viewer?'active':''}><i/>{mine.username} · {state.handCount} carte{state.handCount===1?'':'s'}</span><div className="combat-round-indicators" data-combat-tutorial="rounds" aria-label="Progression des trois manches">{[1,2,3].map(roundNumber=>{const result=state.history.find(item=>item.round===roundNumber);const status=result?(result.winner===viewer?'won':result.winner===enemy?'lost':'tied'):roundNumber===state.round&&state.status==='active'?'current':'future';const label=status==='won'?'gagnée':status==='lost'?'perdue':status==='tied'?'égalité':status==='current'?'en cours':'à venir';const tooltip=`Manche ${roundNumber} · ${label}`;return <span key={roundNumber} className={`combat-round-indicator ${status}`} aria-label={tooltip} data-tooltip={tooltip} tabIndex={0}>{roundNumber}</span>})}</div><span className={state.turn===enemy?'active':''}><i/>{other.username} · {state.opponentHandCount} carte{state.opponentHandCount===1?'':'s'}</span></div>
      <div className={`combat-field-updates${latestEffect?' has-latest-effect':''}`}>
        <div className={`combat-weather-announcement weather-${state.weather.id}`} data-combat-tutorial="weather"><span className="combat-weather-announcement-icon"><WeatherIcon size={20}/></span><div><small>INCIDENT SYSTÈME TIRÉ AU SORT</small><b>{state.weather.name}</b><span>{state.weather.description}</span></div><strong>{state.weather.row?`CANAL ${rowTech[state.weather.row].toUpperCase()} TOUCHÉ`:'TOUS LES CANAUX NOMINAUX'}</strong></div>
        {latestEffect&&<div className="combat-activation-banner" role="status" aria-live="polite"><span><Zap size={15}/></span><div><small>EFFET DU DERNIER DÉPLOIEMENT</small><b>{latestEffect.text}</b></div></div>}
      </div>
      <div className="combat-effect-key" data-combat-tutorial="effects" aria-label="Légende des effets du plateau"><span><i className="positive">↑</i> Bonus actif</span><span><i className="negative">↓</i> Puissance diminuée · survole la carte pour voir pourquoi</span></div>
      <div className={`combat-board${opponentPassed?' has-opponent-passed':''}`} data-combat-tutorial="lanes">
        {COMBAT_ROWS.map(row=><CombatLane key={row} row={row} theme={theme} weatherRow={state.weather.row} weatherId={state.weather.id} enemyCards={state.board[enemy][row]} ownCards={state.board[viewer][row]} enemyScore={state.rowScore[enemy][row]} ownScore={state.rowScore[viewer][row]} enemyName={other.username} ownName={mine.username} enemySide={enemy} ownSide={viewer} selectedCard={selectedCard} draggingCardId={draggingCardId} canPlay={myTurn&&!busy} onSelectRow={card=>{onPlay(card,row);setSelected(null);setInspectedCardId(null);setHandInspection(null)}} onDropCard={cardId=>{const card=state.hand.find(item=>item.id===cardId);if(card&&myTurn&&!busy)onPlay(card,row);setSelected(null);setDraggingCardId(null);setInspectedCardId(null);setHandInspection(null)}}/>) }
        {opponentPassed&&<div className="combat-opponent-passed-overlay" role="status" aria-live="polite"><small>MANCHE TERMINÉE POUR L’ADVERSAIRE</small><strong>{other.username} a passé son tour</strong><span>Il ne jouera plus jusqu’à la prochaine manche.</span></div>}
      </div>
    </div>
      <div className="combat-hand-zone" data-combat-tutorial="hand"><div className="combat-hand-heading"><div><span className="combat-kicker">TA MAIN</span><h3>{myTurn?'Choisis ton prochain coup':state.status==='finished'?'Cartes jouées':'L’adversaire réfléchit…'}</h3></div><span>{state.handCount} <small>CARTES DISPONIBLES</small></span></div><p className="combat-input-hint">Sur ordinateur, glisse une carte vers un canal. Sur mobile, touche une carte puis le canal.</p>
      <div className="combat-hand-scroller"><button type="button" className="combat-hand-scroll-button" aria-label="Faire défiler la main vers la gauche" disabled={!handCanScroll.left} onClick={()=>handScrollRef.current?.scrollBy({left:-320,behavior:'smooth'})}><ChevronLeft size={18}/></button><div className="combat-hand-cards" ref={handScrollRef} onScroll={updateHandScroll}>{orderedHand.map((card,index)=>{return <button type="button" key={`${card.id}-${card.isShiny}`} className={`combat-hand-card ${rarityClass[card.rarity]??'common'}${card.isShiny?' shiny':''}${selected===card.id?' selected':''}`} onClick={event=>{if(!myTurn||busy){showHandInspection(card.id,event.currentTarget);return}if(selected===card.id){setSelected(null);setInspectedCardId(null);setHandInspection(null)}else{setSelected(card.id);showHandInspection(card.id,event.currentTarget)}}} onMouseEnter={event=>showHandInspection(card.id,event.currentTarget)} onMouseLeave={scheduleHandInspectionClose} onFocus={event=>showHandInspection(card.id,event.currentTarget)} onBlur={scheduleHandInspectionClose} onDragStart={(event:DragEvent<HTMLButtonElement>)=>{setSelected(card.id);setDraggingCardId(card.id);setHandInspection(null);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',card.id)}} onDragEnd={()=>setDraggingCardId(null)} draggable={myTurn&&!busy} aria-disabled={!myTurn||busy} aria-describedby={inspectedCardId===card.id&&handInspection?`combat-hand-tip-${card.id}-${card.isShiny?'shiny':'normal'}`:undefined} aria-label={`${card.name}, ${fullCombatExplanation(card)}`} style={{'--hand-index':index} as React.CSSProperties}>
        <span className="combat-hand-art"><CardMemoryMarks card={card} role={getCombatProfile(card).role}/>{card.imageUrl?<img src={card.imageUrl} alt=""/>:<i>◈</i>}{card.isShiny&&<b className="combat-shiny-mark">✦</b>}<strong>{getCombatBasePower(card)}</strong></span>
      </button>})}</div><button type="button" className="combat-hand-scroll-button" aria-label="Faire défiler la main vers la droite" disabled={!handCanScroll.right} onClick={()=>handScrollRef.current?.scrollBy({left:320,behavior:'smooth'})}><ChevronRight size={18}/></button></div><p className="combat-hand-scroll-hint">Toutes les cartes de ton deck sont accessibles dès le début. Les cartes coupées à droite restent dans ta main : utilise les flèches ou fais défiler horizontalement.</p>
      {inspectedCard&&handInspection&&(handInspection.inline?<div className="combat-hand-inline-inspection"><CombatCardEffectOverlay id={`combat-hand-tip-${inspectedCard.id}-${inspectedCard.isShiny?'shiny':'normal'}`} card={inspectedCard} theme={theme} style={{width:'100%'}} selected={selected===inspectedCard.id} prompt={selected===inspectedCard.id?'Touche un canal pour jouer cette carte.':undefined} onMouseLeave={()=>{}}/></div>:createPortal(<CombatCardEffectOverlay id={`combat-hand-tip-${inspectedCard.id}-${inspectedCard.isShiny?'shiny':'normal'}`} card={inspectedCard} theme={theme} style={{left:handInspection.left,top:handInspection.top,width:handInspection.width}} selected={selected===inspectedCard.id} prompt={selected===inspectedCard.id?`Glisse la carte sur un canal${window.innerWidth<=780?' ou touche le canal voulu':''}.`:undefined} onMouseEnter={()=>{if(inspectionCloseTimer.current!==null)window.clearTimeout(inspectionCloseTimer.current)}} onMouseLeave={()=>{setInspectedCardId(null);setHandInspection(null)}}/>,document.body))}
      {state.status==='active'&&<div className="combat-turn-actions" data-combat-tutorial="pass"><p>{myTurn?'« Passer » arrête tes actions jusqu’à la fin de cette manche ; tu ne quittes pas le duel. L’adversaire peut encore jouer. Si vous passez tous les deux, les lignes remportées décident la manche. Ta main restante est gardée pour la suite.':state.passed.includes(viewer)?'Tu as passé cette manche : tu ne peux plus y jouer, mais l’adversaire continue.':'Chaque canal, chaque point et chaque carte comptent.'}</p><button type="button" className="combat-pass-button" onClick={onPass} disabled={!myTurn||busy} aria-label="Arrêter de jouer pour cette manche, sans quitter le duel"><Wind size={15}/>{busy?'Résolution…':'Passer cette manche'}</button></div>}
    </div>
    {state.history.length>0&&<section className="combat-history-section" aria-label="Résultats des manches"><header className="combat-history-heading"><strong>Résultats des manches</strong><small>Scores affichés dans cet ordre : {mine.username} – {other.username}</small></header><div className="combat-history-timeline">{state.history.map(round=>{const outcome=round.winner===viewer?'won':round.winner===enemy?'lost':'tied';const label=outcome==='won'?'GAGNÉE':outcome==='lost'?'PERDUE':'ÉGALITÉ';const myScore=viewer==='p1'?round.p1:round.p2;const enemyScore=viewer==='p1'?round.p2:round.p1;return <div key={round.round} className={outcome} aria-label={`Manche ${round.round} : ${label}, ${myScore} à ${enemyScore}`}><span>M{String(round.round).padStart(2,'0')}</span><b>{myScore} – {enemyScore}</b><small>{label}</small><em>Incident · {weatherNameFor(round.weather)}</em></div>})}</div></section>}
    {tutorialOpen&&<GuidedTutorial steps={battleTutorial} onClose={()=>setTutorialOpen(false)}/>}
    {rulesOpen&&<CombatRulebookDialog theme={theme} onClose={()=>setRulesOpen(false)}/>}
  </section>;
}

function TurnAnnouncementOverlay({announcement}:{announcement:TurnAnnouncement}){
  const Icon=announcement.kind==='round'||announcement.kind==='match'?Trophy:announcement.kind==='daemon'||announcement.kind==='daemon-play'?Bot:Swords;
  const isResult=announcement.kind==='round'||announcement.kind==='match';
  return <div key={`${announcement.kind}-${announcement.title}-${announcement.detail??''}`} className={`combat-turn-announcement ${announcement.kind}${announcement.outcome?` ${announcement.outcome}`:''}`} role="status" aria-live="assertive">
    <div className="combat-turn-announcement-card"><span><Icon size={27}/></span>{!isResult&&<small>{announcement.kind==='daemon'||announcement.kind==='daemon-play'?'LE DAEMON DU CAMPUS':'TON TOUR'}</small>}<strong>{announcement.title}</strong>{!isResult&&announcement.detail&&<p>{announcement.detail}</p>}</div>
  </div>;
}

function CombatLane({row,theme,weatherRow,weatherId,enemyCards,ownCards,enemyScore,ownScore,enemyName,ownName,enemySide,ownSide,selectedCard,draggingCardId,canPlay,onSelectRow,onDropCard}:{row:CombatRow;theme:'dark'|'light';weatherRow:CombatRow|null;weatherId:CombatWeatherId;enemyCards:BattleCardSnapshot[];ownCards:BattleCardSnapshot[];enemyScore:number;ownScore:number;enemyName:string;ownName:string;enemySide:CombatSide;ownSide:CombatSide;selectedCard:CombatCard|null;draggingCardId:string|null;canPlay:boolean;onSelectRow:(card:CombatCard)=>void;onDropCard:(cardId:string)=>void}){
  const [dragOver,setDragOver]=useState(false);
  const acceptsDrop=Boolean(draggingCardId&&canPlay);
  return <div className={`combat-lane${weatherRow===row?` weather-hit${weatherId!=='clear'?` weather-hit-${weatherId}`:''}`:''}${acceptsDrop?' drop-ready':''}${dragOver?' drag-over':''}`} onDragOver={event=>{if(!acceptsDrop)return;event.preventDefault();event.dataTransfer.dropEffect='move';setDragOver(true)}} onDragLeave={()=>setDragOver(false)} onDrop={event=>{if(!canPlay)return;event.preventDefault();const cardId=event.dataTransfer.getData('text/plain')||draggingCardId;setDragOver(false);if(cardId)onDropCard(cardId)}}>
    {weatherRow===row&&weatherId!=='clear'&&<WeatherFX id={weatherId}/>}
    <div className={`combat-row-side own-cards${ownScore>enemyScore?' is-leading':''}`} aria-label={`${ownName}, canal ${rowTech[row]}${ownScore>enemyScore?', en tête':''}`}>{ownCards.map((card,index)=><BattleCard key={`${card.id}-${card.isShiny}-${index}`} card={card} side={ownSide} align="left" theme={theme}/>)}</div>
    <div className="combat-lane-marker"><span>{rowTech[row]}</span><b>{row==='melee'?'✦':row==='ranged'?'⌁':'⌬'}</b><small><i className={ownScore>enemyScore?'is-leading':''}>{ownScore}</i><i className={enemyScore>ownScore?'is-leading':''}>{enemyScore}</i></small></div>
    <div className={`combat-row-side enemy-cards${enemyScore>ownScore?' is-leading':''}`} aria-label={`${enemyName}, canal ${rowTech[row]}${enemyScore>ownScore?', en tête':''}`}>{enemyCards.map((card,index)=><BattleCard key={`${card.id}-${card.isShiny}-${index}`} card={card} side={enemySide} align="right" theme={theme}/>)}</div>
    {selectedCard&&canPlay&&<button type="button" className="combat-lane-target" onClick={()=>onSelectRow(selectedCard)}><Target size={14}/>JOUER ICI</button>}
  </div>;
}

function BattleCard({card,side,align,theme}:{card:BattleCardSnapshot;side:CombatSide;align:'left'|'right';theme:'dark'|'light'}){
  const [inspection,setInspection]=useState<{left:number;top:number;width:number}|null>(null);
  const closeTimer=useRef<number|null>(null);
  const tone=card.effectTone;
  const profile=getCombatProfile(card);
  const markerMeaning=tone==='positive'?'Flèche bleue : un bonus est actif sur cette carte.':tone==='negative'?'Flèche rouge : un malus réduit sa puissance. Survole pour voir la cause.':tone==='mixed'?'Flèche double : bonus et malus actifs. Survole pour voir les détails.':'';
  const accessibleDescription=`${card.name}, ${card.power} points. ${fullCombatExplanation(card)} ${card.effectReasons.join(' ')}`;
  const showInspection=(element:HTMLElement)=>{
    if(closeTimer.current!==null)window.clearTimeout(closeTimer.current);
    const rect=element.getBoundingClientRect(),width=Math.min(480,window.innerWidth-24),left=align==='left'?Math.min(rect.left,window.innerWidth-width-12):Math.max(12,rect.right-width),height=360;
    const top=window.innerHeight-rect.bottom>height+20?rect.bottom+10:Math.max(12,rect.top-height-10);
    setInspection({left,top,width});
  };
  const scheduleClose=()=>{if(closeTimer.current!==null)window.clearTimeout(closeTimer.current);closeTimer.current=window.setTimeout(()=>setInspection(null),180)};
  useEffect(()=>()=>{if(closeTimer.current!==null)window.clearTimeout(closeTimer.current)},[]);
  return <>
    <button type="button" className={`combat-board-card ${rarityClass[card.rarity]??'common'}${card.isShiny?' shiny':''}${card.owner===side?'':' spy-card'}${tone?` effect-${tone}`:''}${inspection?' info-open':''}`} aria-label={accessibleDescription} aria-expanded={Boolean(inspection)} onMouseEnter={event=>showInspection(event.currentTarget)} onMouseLeave={scheduleClose} onFocus={event=>showInspection(event.currentTarget)} onBlur={()=>setInspection(null)} onClick={event=>showInspection(event.currentTarget)}>
    <CardMemoryMarks card={card} role={profile.role}/>
    {tone&&<span className="combat-board-effect-mark" aria-label={markerMeaning} title={markerMeaning}>{tone==='positive'?'↑':tone==='negative'?'↓':'↕'}</span>}
    <span className="combat-board-card-art">{card.imageUrl?<img src={card.imageUrl} alt=""/>:<i>◈</i>}{card.isShiny&&<b className="combat-shiny-mark">✦</b>}<strong>{card.power}</strong></span>
    </button>
    {inspection&&createPortal(<CombatCardEffectOverlay card={card} theme={theme} style={{left:inspection.left,top:inspection.top,width:inspection.width}} fieldStatus={{tone,bonuses:card.effectBonuses,maluses:card.effectMaluses,notes:card.effectNotes,power:card.power}} onMouseEnter={()=>{if(closeTimer.current!==null)window.clearTimeout(closeTimer.current)}} onMouseLeave={()=>setInspection(null)}/>,document.body)}
  </>;
}

function WeatherFX({id}:{id:CombatWeatherId}){
  const particles=Array.from({length:id==='storm'?44:id==='fog'?36:24},(_,index)=><i key={index} style={{'--weather-left':`${(index*37)%100}%`,'--weather-top':`${12+(index%8)*10}%`,'--weather-delay':`${-(index%19)*.31}s`,'--weather-duration':`${id==='fog'?1.15+(index%8)*.18:1.5+(index%9)*.22}s`,'--weather-drift':`${(index%2?1:-1)*(id==='fog'?70+(index*11)%135:8+(index*11)%36)}px`} as CSSProperties}>{id==='storm'&&<span>{index%2?'01':'10'}</span>}</i>);
  return <div className={`combat-weather-fx weather-fx-${id}`} aria-hidden="true"><div className="combat-weather-clouds"/><div className="combat-weather-particles">{particles}</div>{id==='storm'&&<><i className="combat-lightning-bolt"/><i className="combat-lightning-flash"/></>}</div>;
}
