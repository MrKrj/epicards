/**
 * SQL predicate for cards the community has actually discovered.
 * Historical copies still count after recycling; shiny-only copies and cards
 * owned solely by administrators do not reveal a base card to players.
 */
export const COMMUNITY_DISCOVERED_CARD_PREDICATE = `
  c.rarity NOT IN ('Secrète','Secrete','secrète','secrete','SECRÈTE','SECRETE')
  AND EXISTS (
    SELECT 1
    FROM card_instances discovered
    JOIN users discoverer ON discoverer.id=discovered.owner_id
    WHERE discovered.card_id=c.id
      AND discovered.is_shiny=0
      AND discoverer.role IN ('player','moderator')
  )`;

/**
 * Mini-games use the same community discovery rule, but a shiny copy still
 * counts as discovery of its underlying card. Secret cards remain excluded.
 */
export const COMMUNITY_DISCOVERED_MINIGAME_CARD_PREDICATE = `
  c.rarity NOT IN ('Secrète','Secrete','secrète','secrete','SECRÈTE','SECRETE')
  AND EXISTS (
    SELECT 1
    FROM card_instances discovered
    JOIN users discoverer ON discoverer.id=discovered.owner_id
    WHERE discovered.card_id=c.id
      AND discoverer.role IN ('player','moderator')
  )`;
