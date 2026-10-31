/** Set membership directly so repeated UI events cannot toggle a removed card back in. */
export function setCombatDeckSelection(current:readonly string[],key:string,selected:boolean):string[]{
  if(!selected)return current.filter(item=>item!==key);
  return current.includes(key)?[...current]:[...current,key];
}
