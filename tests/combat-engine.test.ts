import { describe, expect, it } from 'vitest';
import { COMBAT_ROWS, CombatRuleError, combatSnapshot, createCombatState, effectiveCardPower, getBoardScore, getCombatRowScore, passCombatRound, playCombatCard, resolveComputerTurn, resolveComputerTurns, validateCombatDeck, type CombatCard } from '../lib/combat-engine';

const card=(id:string,rarity='Commune',setId='epitech'):CombatCard=>({id,name:`Carte ${id}`,rarity,category:'Catégorie libre',setId,setName:setId,imageUrl:null,isShiny:false,combatProfile:{role:'stack',power:5,stability:5,expertise:5}});
const deck=():CombatCard[]=>[card('co1'),card('co2'),card('co3'),card('pc1','Peu commune'),card('pc2','Peu commune'),card('ra1','Rare'),card('ep1','Épique'),card('le1','Légendaire'),card('se1','Secrète'),card('co4')];
const game=()=>createCombatState({mode:'pvp',player1:{id:1,username:'Ada'},player2:{id:2,username:'Turing'},deck1:deck(),deck2:deck().map(item=>({...item,id:`b-${item.id}`})),randomIndex:()=>0});

describe('règles du combat par rang et rareté',()=>{
  it('autorise plusieurs cartes communes, mais une seule carte de chaque rareté supérieure',()=>{
    expect(validateCombatDeck(deck())).toBeNull();
    expect(validateCombatDeck([...deck(),card('ra2','Rare')])).toContain('qu’une carte rare');
  });

  it('fait monter le moral des autres cartes de la rangée avec une Peu commune',()=>{
    const state=game();state.weatherId='clear';state.board.p1.melee=[{...card('ally'),owner:'p1'}];
    state.hands.p1=[card('morale','Peu commune')];state.turn='p1';
    playCombatCard(state,'p1','morale','melee');
    expect(getBoardScore(state,'p1')).toBe(6);
  });

  it('journalise précisément le protocole activé sur les cartes déjà en jeu',()=>{
    const state=game();state.weatherId='clear';state.board.p1.melee=[{...card('ally'),owner:'p1'},{...card('pc1','Peu commune'),owner:'p1'}];
    state.hands.p1=[card('pc2','Peu commune')];state.turn='p1';
    playCombatCard(state,'p1','pc2','melee');
    const effectLog=state.log.findLast(line=>line.kind==='effect');
    expect(effectLog?.text).toContain('Renfort actif');
    expect(effectLog?.text).toContain('Carte ally +1');
  });

  it('double une Rare lorsque sa série est déjà représentée dans la rangée',()=>{
    const state=game();state.weatherId='clear';state.board.p1.ranged=[{...card('common'),owner:'p1'}];
    const rare={...card('rare','Rare'),owner:'p1' as const};state.board.p1.ranged.push(rare);
    expect(effectiveCardPower(state,'p1','ranged',rare)).toBe(8);
  });

  it('place une Épique chez l’adversaire sans pioche, car toute la main est disponible au début',()=>{
    const state=game();state.hands.p1=[card('spy','Épique'),card('available')];state.drawPiles.p1=[];state.turn='p1';
    playCombatCard(state,'p1','spy','siege');
    expect(state.board.p2.siege[0]).toMatchObject({id:'spy',owner:'p1'});
    expect(state.hands.p1.map(item=>item.id)).toEqual(['available']);
    expect(state.drawPiles.p1).toHaveLength(0);
    expect(getBoardScore(state,'p1')).toBe(1);
    expect(getBoardScore(state,'p2')).toBe(0);
    expect(getCombatRowScore(state,'p1','siege')).toBe(1);
  });

  it('rend toutes les cartes du deck accessibles dès le début du combat',()=>{
    const state=game();
    expect(state.hands.p1).toHaveLength(deck().length);
    expect(state.hands.p2).toHaveLength(deck().length);
    expect(state.drawPiles.p1).toHaveLength(0);
    expect(state.drawPiles.p2).toHaveLength(0);
  });

  it('migre la réserve des combats déjà sauvegardés vers la main à la reprise',()=>{
    const state=game();
    state.hands.p1=[card('already-in-hand')];
    state.drawPiles.p1=[card('from-old-reserve')];
    const snapshot=combatSnapshot(state,'p1');
    expect(snapshot.hand.map(item=>item.id)).toEqual(['already-in-hand','from-old-reserve']);
    expect(state.drawPiles.p1).toHaveLength(0);
  });

  it('ne renvoie jamais la main adverse dans la vue d’un match',()=>{
    const state=game();
    const snapshot=combatSnapshot(state,'p1');
    expect(snapshot.hand).toHaveLength(state.hands.p1.length);
    expect(snapshot).not.toHaveProperty('hands');
    expect(snapshot).not.toHaveProperty('drawPiles');
    expect(snapshot.opponentHandCount).toBe(state.hands.p2.length);
  });

  it('la Légendaire résiste à la météo de sa rangée',()=>{
    const state=game();state.weatherId='storm';
    const hero={...card('hero','Légendaire'),owner:'p1' as const};state.board.p1.siege=[hero];
    expect(effectiveCardPower(state,'p1','siege',hero)).toBe(5);
    state.board.p1.siege.push({...card('unit','Commune'),owner:'p1'});
    expect(effectiveCardPower(state,'p1','siege',state.board.p1.siege[1])).toBe(1);
  });

  it('expose une surbrillance négative pour la météo et positive pour le Noyau protégé',()=>{
    const state=game();state.weatherId='frost';state.board.p1.melee=[{...card('unit'),owner:'p1'},{...card('hero','Légendaire'),owner:'p1'}];
    const snapshot=combatSnapshot(state,'p1');
    expect(snapshot.board.p1.melee.find(item=>item.id==='unit')).toMatchObject({power:1,effectTone:'negative'});
    expect(snapshot.board.p1.melee.find(item=>item.id==='hero')).toMatchObject({power:5,effectTone:'positive'});
    expect(snapshot.board.p1.melee.find(item=>item.id==='hero')?.effectReasons[0]).toContain('Protection');
  });

  it('explique que la météo plafonne la puissance après un bonus API',()=>{
    const state=game();state.weatherId='fog';
    const api={...card('api-card'),combatProfile:{role:'api' as const,power:10,stability:10,expertise:10},owner:'p1' as const};
    state.board.p1.ranged=[api];
    const result=combatSnapshot(state,'p1').board.p1.ranged.find(item=>item.id==='api-card');
    expect(result).toMatchObject({power:1,effectTone:'mixed'});
    expect(result?.effectBonuses.join(' ')).toContain('API : +2 puissance');
    expect(result?.effectMaluses.join(' ')).toContain('Latence réseau');
  });

  it('met en évidence le couplage de build Rare sur le plateau',()=>{
    const state=game();state.weatherId='clear';state.board.p1.ranged=[{...card('ally'),owner:'p1'},{...card('rare','Rare'),owner:'p1'}];
    const snapshot=combatSnapshot(state,'p1');
    expect(snapshot.board.p1.ranged.find(item=>item.id==='rare')).toMatchObject({power:8,effectTone:'positive'});
    expect(snapshot.board.p1.ranged.find(item=>item.id==='rare')?.effectReasons.join(' ')).toContain('Double puissance');
  });

  it('différencie deux cartes de même rareté avec un écart statistique plafonné',()=>{
    const state=game();state.weatherId='clear';
    const strong={...card('strong'),combatProfile:{role:'stack' as const,power:10,stability:10,expertise:10},owner:'p1' as const};
    const weak={...card('weak'),combatProfile:{role:'stack' as const,power:1,stability:1,expertise:1},owner:'p2' as const};
    state.board.p1.melee=[strong];state.board.p2.melee=[weak];
    expect(effectiveCardPower(state,'p1','melee',strong)).toBe(4);
    expect(effectiveCardPower(state,'p2','melee',weak)).toBe(2);
  });

  it('intègre le profil automatique à la puissance de base sans afficher de malus technique',()=>{
    const state=game();state.weatherId='clear';
    const low={...card('low'),combatProfile:{role:'stack' as const,power:1,stability:1,expertise:1},owner:'p1' as const};
    state.board.p1.melee=[low];
    const visible=combatSnapshot(state,'p1').board.p1.melee[0];
    expect(visible.power).toBe(2);
    expect(visible.effectTone).toBeNull();
    expect(visible.effectMaluses).toEqual([]);
  });

  it('Elasticity Cloud renforce la carte alliée la plus puissante d’un autre canal',()=>{
    const state=game();state.weatherId='clear';
    const cloud={...card('cloud-card'),combatProfile:{role:'elasticity_cloud' as const,power:5,stability:5,expertise:5},owner:'p1' as const};
    const ally={...card('ally'),owner:'p1' as const};
    state.board.p1.siege=[cloud];state.board.p1.melee=[ally];
    expect(effectiveCardPower(state,'p1','melee',ally)).toBe(4);
    expect(combatSnapshot(state,'p1').board.p1.melee[0].effectReasons.join(' ')).toContain('Elasticity Cloud : +1 puissance');
  });

  it('API donne deux points à sa propre carte',()=>{
    const state=game();state.weatherId='clear';
    const api={...card('api','Commune'),combatProfile:{role:'api' as const,power:5,stability:5,expertise:5},owner:'p1' as const};
    state.board.p1.melee=[api];
    expect(effectiveCardPower(state,'p1','melee',api)).toBe(5);
    expect(combatSnapshot(state,'p1').board.p1.melee[0].effectBonuses.join(' ')).toContain('API : +2 puissance');
  });

  it('CI/CD renforce chaque autre carte alliée de son canal',()=>{
    const state=game();state.weatherId='clear';
    const ci={...card('ci','Commune'),combatProfile:{role:'ci_cd' as const,power:5,stability:5,expertise:5},owner:'p1' as const};
    const ally={...card('ally'),owner:'p1' as const};
    state.board.p1.melee=[ally];state.hands.p1=[ci];state.turn='p1';
    playCombatCard(state,'p1','ci','melee');
    expect(effectiveCardPower(state,'p1','melee',ally)).toBe(4);
    expect(combatSnapshot(state,'p1').board.p1.melee[0].effectReasons.join(' ')).toContain('CI/CD : +1 puissance');
  });

  it('Unit Test retire deux points à la carte adverse la plus puissante du canal',()=>{
    const state=game();state.weatherId='clear';
    const strongest={...card('strong'),combatProfile:{role:'stack' as const,power:10,stability:10,expertise:10},owner:'p1' as const};
    const weaker={...card('weak'),combatProfile:{role:'stack' as const,power:5,stability:5,expertise:5},owner:'p1' as const};
    const test={...card('test'),combatProfile:{role:'unit_test' as const,power:5,stability:5,expertise:5},owner:'p2' as const};
    state.board.p1.ranged=[strongest,weaker];state.board.p2.ranged=[test];
    expect(effectiveCardPower(state,'p1','ranged',strongest)).toBe(2);
    expect(effectiveCardPower(state,'p1','ranged',weaker)).toBe(3);
    expect(combatSnapshot(state,'p1').board.p1.ranged[0].effectMaluses.join(' ')).toContain('Unit Test adverse : −2 puissance');
  });

  it('Stack gagne un point après deux cartes jouées et plafonne à trois',()=>{
    const state=game();state.weatherId='clear';
    const stack={...card('stack'),combatProfile:{role:'stack' as const,power:5,stability:5,expertise:5},owner:'p1' as const,stackPower:0,stackTurns:0};
    state.board.p1.melee=[stack];
    state.hands.p1=Array.from({length:8},(_,index)=>card(`p1-${index+1}`));
    state.hands.p2=[];
    state.turn='p1';
    playCombatCard(state,'p1','p1-1','siege');
    expect(stack.stackTurns).toBe(1);expect(stack.stackPower).toBe(0);
    playCombatCard(state,'p1','p1-2','siege');
    expect(stack.stackPower).toBe(1);
    for(let index=2;index<8;index+=1)playCombatCard(state,'p1',`p1-${index+1}`,'siege');
    expect(stack.stackPower).toBe(3);
  });

  it('une Épique neutralise le rôle technique de la plus puissante carte adverse du canal',()=>{
    const state=game();state.weatherId='clear';
    const api={...card('enemy-api'),combatProfile:{role:'api' as const,power:5,stability:5,expertise:5},owner:'p2' as const};
    state.board.p2.melee=[api];state.hands.p1=[card('spy','Épique')];state.turn='p1';
    playCombatCard(state,'p1','spy','melee');
    expect(state.board.p2.melee[0].technicalSuppressed).toBe(true);
    expect(effectiveCardPower(state,'p2','melee',api)).toBe(3);
    const view=combatSnapshot(state,'p1').board.p2.melee.find(item=>item.id==='enemy-api');
    expect(view?.effectNotes.join(' ')).toContain('neutralisé par une Épique');
    expect(state.log.findLast(line=>line.kind==='effect')?.text).toContain('Effet API de Carte enemy-api neutralisé');
  });

  it('RAM revient une seule manche à la moitié de sa puissance puis est défaussée',()=>{
    const state=game();state.weatherId='clear';
    const ram={...card('ram-card'),combatProfile:{role:'ram' as const,power:5,stability:5,expertise:5},owner:'p1' as const};
    state.board.p1.ranged=[ram];state.board.p1.melee=[{...card('winner','Légendaire'),owner:'p1'}];
    state.hands.p1=[card('p1-next')];state.hands.p2=[card('p2-next')];
    state.turn='p1';passCombatRound(state,'p1');passCombatRound(state,'p2');
    expect(state.round).toBe(2);
    const carried=state.board.p1.ranged[0];
    expect(carried).toMatchObject({id:'ram-card',ramCarryover:true,ramPower:1});
    state.hands.p1=[];state.hands.p2=[];state.passed=[];state.turn='p1';
    passCombatRound(state,'p1');
    expect(state.board.p1.ranged).toHaveLength(0);
    expect(state.discards.p1.some(item=>item.id==='ram-card')).toBe(true);
  });

  it('le Brasier détruit la meilleure carte adverse non héroïque de la rangée ciblée',()=>{
    const state=game();state.weatherId='clear';
    state.board.p2.melee=[{...card('target','Rare'),owner:'p2'},{...card('hero','Légendaire'),owner:'p2'}];
    state.hands.p1=[card('scorch','Secrète')];state.turn='p1';
    playCombatCard(state,'p1','scorch','melee');
    expect(state.board.p2.melee.map(item=>item.id)).toEqual(['hero']);
    expect(state.log.findLast(line=>line.kind==='effect')?.text).toContain('Neutralisation');
  });

  it('passe la manche après le passage des deux joueurs et conserve le score de manches',()=>{
    const state=game();state.weatherId='clear';state.board.p1.melee=[{...card('winner','Légendaire'),owner:'p1'}];state.board.p1.ranged=[{...card('winner-2','Commune'),owner:'p1'}];
    expect(passCombatRound(state,'p1').turn).toBe('p2');
    const settled=passCombatRound(state,'p2');
    expect(settled.round).toBe(2);expect(settled.roundsWon.p1).toBe(1);expect(settled.history[0]).toMatchObject({p1Lanes:2,p2Lanes:0});expect(settled.board.p1.melee).toHaveLength(0);
  });

  it('attribue la manche au camp qui gagne deux lignes même avec moins de points au total',()=>{
    const state=game();state.weatherId='clear';
    state.board.p1.melee=Array.from({length:4},(_,index)=>({...card(`stack-${index}`),owner:'p1' as const}));
    state.board.p2.ranged=[{...card('network-lead'),owner:'p2'}];state.board.p2.siege=[{...card('server-lead'),owner:'p2'}];
    state.hands.p1=[];state.hands.p2=[];state.passed=['p1'];state.turn='p2';
    passCombatRound(state,'p2');
    expect(state.history[0]).toMatchObject({winner:'p2',p1:12,p2:6,p1Lanes:1,p2Lanes:2});
    expect(state.roundsWon.p2).toBe(1);
  });

  it('ne donne pas la manche si aucun camp ne gagne deux lignes',()=>{
    const state=game();state.weatherId='clear';state.board.p1.melee=[{...card('single-lead','Légendaire'),owner:'p1'}];state.passed=['p1'];state.turn='p2';
    passCombatRound(state,'p2');
    expect(state.history[0]).toMatchObject({winner:'draw',p1Lanes:1,p2Lanes:0});
    expect(state.roundsWon).toEqual({p1:0,p2:0});
  });

  it('passe automatiquement le joueur dont la main est vide',()=>{
    const state=game();state.turn='p2';state.hands.p1=[];state.hands.p2=[card('played'),card('remaining')];
    playCombatCard(state,'p2','played','melee');
    expect(state.passed).toContain('p1');
    expect(state.turn).toBe('p2');
    expect(state.log.some(line=>line.text.includes('n’a plus de carte : passe automatiquement'))).toBe(true);
  });

  it('termine automatiquement les manches restantes quand les deux mains sont vides',()=>{
    const state=game();state.weatherId='clear';state.hands.p2=[];state.hands.p1=[card('last-card')];
    state.board.p1.melee=[{...card('lead'),owner:'p1'}];
    playCombatCard(state,'p1','last-card','ranged');
    expect(state.status).toBe('finished');
    expect(state.history).toHaveLength(3);
    expect(state.winner).toBe('p1');
  });

  it('termine un match contre l’IA sans bloquer une manche',()=>{
    const state=createCombatState({mode:'ai',player1:{id:1,username:'Ada'},player2:{id:null,username:'Sentinelle'},deck1:deck(),deck2:deck().map(item=>({...item,id:`ai-${item.id}`})),randomIndex:()=>0});
    let turns=0;
    while(state.status==='active'&&turns++<100){
      if(state.turn==='p1'){
        if(state.hands.p1.length)playCombatCard(state,'p1',state.hands.p1[0].id,COMBAT_ROWS[turns%COMBAT_ROWS.length]);
        else passCombatRound(state,'p1');
      }else resolveComputerTurns(state,()=>0);
    }
    expect(turns).toBeLessThan(100);
    expect(state.status).toBe('finished');
    expect(['p1','p2','draw']).toContain(state.winner);
  });

  it('résout un seul coup de l’IA pour permettre une animation entre les actions',()=>{
    const state=game();state.turn='p2';
    resolveComputerTurn(state,()=>0);
    const deployed=COMBAT_ROWS.reduce((count,row)=>count+state.board.p2[row].length,0);
    expect(deployed).toBe(1);
    expect(state.log.filter(line=>line.kind==='play')).toHaveLength(1);
    expect(state.turn).toBe('p1');
  });

  it('refuse une action de l’autre joueur et un deck trop petit',()=>{
    const state=game();expect(()=>playCombatCard(state,'p2','b-co1','melee')).toThrow(CombatRuleError);
    expect(validateCombatDeck(deck().slice(0,7))).toContain('entre 8 et 12');
  });
});
