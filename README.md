# Epicards — version locale

Une application web locale de collection de cartes Epitech. Elle tourne entièrement sur Node.js : aucun compte Supabase, aucune clé API, aucune base distante et aucune configuration `.env` ne sont nécessaires.

## Démarrage

Prérequis : Node.js 22.13 ou supérieur et npm.

```bash
npm install
npm run dev
```

Ouvre ensuite [http://localhost:3000](http://localhost:3000). Au premier démarrage, l’application crée automatiquement `data/cardverse.sqlite` et y insère les 20 cartes fictives réparties entre Epitech et Somnolences. La base demeure sur cet ordinateur après l’arrêt ou la mise à jour du serveur.

Pour lancer le build local de production :

```bash
npm run build
npm start
```

## Comptes locaux et espace pédagogique

Crée un compte depuis **Se connecter → S’inscrire** avec un pseudo, une adresse en `@epitech.eu` et un mot de passe d’au moins huit caractères. Chaque nouveau compte reçoit 500 fragments, inscrits dans le journal du portefeuille.

Pour initialiser le compte administrateur, copie `.env.example` vers `.env.local`, puis définis `CARDVERSE_ADMIN_EMAIL`, `CARDVERSE_ADMIN_USERNAME` et `CARDVERSE_ADMIN_PASSWORD` (12 caractères minimum). Redémarre le serveur après modification. Au prochain démarrage, ce compte est créé avec le rôle admin ; si l’adresse existe déjà, son rôle est promu sans changer son mot de passe. Garde `.env.local` privé. L’onglet **Espace pédago** est visible uniquement aux comptes dont le rôle admin est confirmé côté serveur. Il permet de créer et modifier des séries et des cartes. Une carte déjà présente dans un inventaire est archivée lors de sa suppression afin de préserver l’historique ; la série par défaut ne peut pas être supprimée. Les mots de passe sont hachés avec `scrypt`. La session est conservée dans un cookie HTTP-only et la base SQLite ne stocke que l’empreinte du jeton de session.

Les comptes et les collections n’existent que dans la base locale de cette installation. Pour recommencer avec une base vide, arrête le serveur et supprime `data/cardverse.sqlite` ainsi que ses fichiers `data/cardverse.sqlite-*`. Le prochain démarrage recréera la base et les cartes de démonstration.

## Packs et collection

Un compte peut ouvrir cinq boosters dans toute fenêtre glissante de cinq heures. Chaque booster contient cinq cartes. La règle et les cinq créations d’exemplaires sont exécutées dans une transaction SQLite côté serveur ; les anciennes ouvertures sont migrées pour conserver le quota après mise à jour. Chaque carte apparaît face cachée : clique dessus pour la retourner. Rare, Épique, Légendaire et Secrète ont des effets distincts, avec secousse pour les deux raretés supérieures. Un petit son synthétisé accompagne chaque révélation ; le bouton de volume permet de le couper. Les sons sont générés par le navigateur et ne nécessitent aucun fichier audio.

La base de démonstration est réinitialisée avec la série par défaut **Epitech** et la série **Somnolences**, dix cartes chacune. « L’ambassadeur IA » est une carte Légendaire illustrée avec le portrait fourni.

La collection, les ouvertures de boosters et les drops sont persistés dans SQLite. Les cartes sont chargées de façon idempotente au démarrage ; le catalogue ne dépend pas du navigateur.

## Fragments et recyclage

Le booster gratuit est réservé à la collection marquée « gratuite » : cinq boosters toutes les cinq heures. Les achats ne consomment pas ce quota. Un booster de la collection par défaut coûte 100 fragments ; un booster d’une autre collection coûte 150 fragments. Chaque achat attribue cinq cartes de la collection choisie et débite le solde dans la même transaction SQLite.

Depuis **Ma collection**, clique sur une carte pour ouvrir sa fiche et recycler un exemplaire contre des fragments : Commune +1, Peu commune +2, Rare +5, Épique +20, Légendaire +100 et Secrète +500. Le solde et le recyclage sont enregistrés dans SQLite.

## Persistance et sauvegarde

La base se trouve dans `data/cardverse.sqlite` (mode WAL). Pour une sauvegarde simple, arrête `npm run dev`, copie le fichier et ses éventuels fichiers `-wal`/`-shm` vers un emplacement sûr, puis redémarre. Les illustrations importées dans l’espace pédago sont stockées dans `public/uploads/cards/` : copie aussi ce dossier si tu veux sauvegarder toutes les images. Pour restaurer, arrête le serveur, replace la base dans `data/` et les illustrations sous `public/uploads/cards/`.

Ne partage pas la base : elle contient les comptes, les adresses e-mail, les hachages de mots de passe et les inventaires. La base et les illustrations importées sont ignorées par Git.

## Dépendances et vérification

- Next.js App Router et React pour l’application locale.
- API Route Handlers Node.js pour les comptes, sessions, catalogue et drops.
- SQLite intégré à Node (`node:sqlite`) pour la base persistante ; aucune base à installer.
- Zod pour valider les formulaires côté interface et côté serveur.

Commandes de vérification :

```bash
npm test
npm run build
```

Les tests couvrent la création de compte Epitech, le rejet des autres domaines, les mots de passe hachés, le quota de cinq boosters par cinq heures, les cinq exemplaires par booster et la configuration des probabilités. Le build de production est exécuté localement dans le cadre du développement.

## Périmètre de cette version locale

Les administrateurs peuvent importer les illustrations des cartes en JPEG, PNG ou WebP (5 Mo maximum) ; les fichiers restent localement dans `public/uploads/cards/`. Cette version permet de créer un compte local, se connecter, consulter le catalogue, ouvrir les boosters de cinq cartes, retourner les cartes, voir sa collection et filtrer/rechercher les cartes. Les données ne sont pas synchronisées entre appareils. La vente et les échanges sont désactivés pour le moment, tout comme les classements, les notifications et l’administration. Pour un usage multi-utilisateur partagé sur Internet, il faudra héberger le serveur et choisir une base de données adaptée plutôt que partager un fichier SQLite.
