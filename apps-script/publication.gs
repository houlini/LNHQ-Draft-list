/* =========================================================================
   LNHQ — application web de publication (Nouvelles et Annonces).
   À coller dans l'éditeur Apps Script du classeur PRIVÉ « LNHQ — Accès »
   (Extensions → Apps Script). Appelée uniquement par le Worker Cloudflare de
   publier.lnhq.ca, qui a déjà vérifié le courriel de la personne avec Access.

   Installation : exécuter « installer » une fois (crée l'onglet ACCES, le dossier
   des photos et le code secret partagé avec le Worker), puis Déployer → Nouveau
   déploiement → Application Web : « Exécuter en tant que : moi »,
   « Qui a accès : Tout le monde ».

   Les webhooks Discord sont des secrets du Worker (WEBHOOK_NOUVELLES,
   WEBHOOK_ANNONCES) : c'est lui qui envoie les messages.
   ========================================================================= */

const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';
const ONGLET_ACCES = 'ACCES';
const ONGLET_JOURNAL = 'JOURNAL';
const TYPES = {
  NOUVELLES: ['Général', 'Transaction', 'Résultat', 'Blessure'],
  ANNONCES: ['Général', 'Règlement', 'Calendrier', 'Événement'],
};
// Les annonces sont signées au nom de la ligue, pas de l'équipe de la personne.
const SIGNATURE_ANNONCES = 'Commissaire de la ligue';
// Code des logos (lnhq.ca/Logos/XXX.png), pour l'avatar des messages Discord.
const CODES_EQUIPES = {
  'Anaheim': 'ANA', 'Boston': 'BOS', 'Buffalo': 'BUF', 'Calgary': 'CGY', 'Caroline': 'CAR', 'Chicago': 'CHI',
  'Colorado': 'COL', 'Columbus': 'CBJ', 'Dallas': 'DAL', 'Detroit': 'DET', 'Edmonton': 'EDM', 'Floride': 'FLA',
  'Los Angeles': 'LAK', 'Minnesota': 'MIN', 'Montréal': 'MTL', 'Nashville': 'NSH', 'New Jersey': 'NJD',
  'NY Islanders': 'NYI', 'NY Rangers': 'NYR', 'Ottawa': 'OTT', 'Philadelphie': 'PHI', 'Pittsburgh': 'PIT',
  'San Jose': 'SJS', 'Seattle': 'SEA', 'St. Louis': 'STL', 'Tampa Bay': 'TBL', 'Toronto': 'TOR', 'Utah': 'UTA',
  'Vancouver': 'VAN', 'Vegas': 'VGK', 'Washington': 'WSH', 'Winnipeg': 'WPG',
};
const EQUIPES = [
  'Anaheim', 'Boston', 'Buffalo', 'Calgary', 'Caroline', 'Chicago', 'Colorado', 'Columbus',
  'Dallas', 'Detroit', 'Edmonton', 'Floride', 'Los Angeles', 'Minnesota', 'Montréal', 'Nashville',
  'New Jersey', 'NY Islanders', 'NY Rangers', 'Ottawa', 'Philadelphie', 'Pittsburgh', 'San Jose',
  'Seattle', 'St. Louis', 'Tampa Bay', 'Toronto', 'Utah', 'Vancouver', 'Vegas', 'Washington', 'Winnipeg',
];
const ENTETES = ['Date', 'Équipe', 'Type', 'Titre', 'Texte', 'Photos', 'Visible', 'Épinglé', 'ID Discord', 'ID réponse'];
const COULEURS_TYPE = {
  'Transaction': 0x1C7ED6, 'Résultat': 0x2F9E44, 'Blessure': 0xE03131, 'Général': 0xE8590C,
  'Règlement': 0x7048E8, 'Calendrier': 0x1098AD, 'Événement': 0xE0A800,
};
const TYPES_PHOTO = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_OCTETS_PHOTO = 5 * 1024 * 1024;

function installer() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  if (!classeur.getSheetByName(ONGLET_ACCES)) {
    const acces = classeur.insertSheet(ONGLET_ACCES);
    acces.appendRow(['Courriel', 'Équipe', 'Annonces']);
    acces.setFrozenRows(1);
    acces.getRange('B2:B200').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['Ligue'].concat(EQUIPES)).build());
    acces.getRange('C2:C200').insertCheckboxes();
  }
  if (!classeur.getSheetByName(ONGLET_JOURNAL)) {
    classeur.insertSheet(ONGLET_JOURNAL).appendRow(['Date', 'Courriel', 'Flux', 'Titre', 'ID']);
  }
  dossierPhotos();
  // Onglets publics des deux fils, avec leurs en-têtes et le format texte forcé :
  // à créer ici plutôt qu'à la main (sinon un ID Discord devient un nombre arrondi).
  ['NOUVELLES', 'ANNONCES'].forEach(ouvrirOnglet);
  installerEncheres();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
  console.log('Installation terminée. Le code SECRET est dans les propriétés du script.');
}

// Le Worker passe action, courriel et secret dans l'adresse ; le corps (titre,
// texte, photos) est transmis tel quel, sans que le Worker ait à le relire.
function doPost(e) {
  let resultat;
  try {
    resultat = traiter(e.parameter || {}, e.postData ? e.postData.contents : '');
  } catch (err) {
    console.error(err);
    resultat = { ok: false, erreur: 'interne' };
  }
  return ContentService.createTextOutput(JSON.stringify(resultat)).setMimeType(ContentService.MimeType.JSON);
}

function traiter(p, corps) {
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || p.secret !== secret) return { ok: false, erreur: 'secret' };
  // Appelée chaque minute par le Worker (tâche planifiée), sans membre connecté.
  if (p.action === 'cloturerEncheres') return cloturerEncheres();
  const membre = trouverMembre(p.courriel);
  if (!membre) return { ok: false, erreur: 'inconnu' };
  if (p.action === 'moi') return { ok: true, equipe: membre.equipe, annonces: membre.annonces };
  if (p.action === 'publier') return publier(JSON.parse(corps || '{}'), membre);
  if (p.action === 'lire') return lire(JSON.parse(corps || '{}'), membre);
  if (p.action === 'recentes') return recentes(membre);
  if (p.action === 'modifier') return modifier(JSON.parse(corps || '{}'), membre);
  if (p.action === 'photo') return photoSeule(JSON.parse(corps || '{}'));
  if (p.action === 'discord') return noterDiscord(JSON.parse(corps || '{}'), membre);
  if (p.action === 'enAttente') return enAttente(membre);
  if (p.action === 'lancerEnchere') return lancerEnchere(JSON.parse(corps || '{}'), membre);
  if (p.action === 'miserEnchere') return miserEnchere(JSON.parse(corps || '{}'), membre);
  return { ok: false, erreur: 'action' };
}

// Image insérée dans le texte : enregistrée tout de suite pour que l'éditeur
// puisse l'afficher et la placer à l'endroit du curseur.
function photoSeule(photo) {
  if (!TYPES_PHOTO.includes(photo && photo.mime)) return { ok: false, erreur: 'photo' };
  const id = enregistrerPhoto(photo);
  return { ok: true, id: id, url: urlPhoto(id) };
}

function trouverMembre(courriel) {
  const cherche = String(courriel || '').trim().toLowerCase();
  if (!cherche) return null;
  const lignes = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONGLET_ACCES).getDataRange().getValues();
  const ligne = lignes.slice(1).find(l => String(l[0]).trim().toLowerCase() === cherche);
  if (!ligne) return null;
  return { courriel: cherche, equipe: String(ligne[1] || '').trim() || 'Ligue', annonces: ligne[2] === true };
}

function publier(d, membre) {
  const flux = d.flux === 'ANNONCES' ? 'ANNONCES' : 'NOUVELLES';
  if (flux === 'ANNONCES' && !membre.annonces) return { ok: false, erreur: 'annonces' };
  const champs = lireChamps(d, flux);
  if (champs.erreur) return { ok: false, erreur: champs.erreur };

  const v = {
    titre: champs.titre,
    texte: champs.texte,
    type: champs.type,
    // L'équipe vient de la liste d'accès, jamais du navigateur.
    equipe: flux === 'ANNONCES' ? SIGNATURE_ANNONCES : membre.equipe,
    // Colonne Photos du classeur : la couverture seulement ; les autres images sont dans le texte.
    photos: d.couverture ? [enregistrerPhoto(d.couverture)] : [],
  };

  const id = Utilities.getUuid();
  const date = new Date();
  const pageUrl = lienPage(flux, id);

  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const onglet = ouvrirOnglet(flux);
    onglet.appendRow([date, v.equipe, v.type, v.titre, v.texte, v.photos.join(','), true, false, '', id]);
    const cases = onglet.getRange(onglet.getLastRow(), 7, 1, 2);
    cases.insertCheckboxes();
    cases.setValues([[true, false]]);
    // L'auteur reste dans ce classeur privé, jamais dans le classeur public.
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONGLET_JOURNAL)
      .appendRow([date, membre.courriel, flux, v.titre, id, '']);
  } finally {
    verrou.releaseLock();
  }
  // Le message Discord est envoyé par le Worker Cloudflare : Discord bloque souvent
  // les adresses de Google partagées par tous les scripts (erreur 429 / 1015).
  return { ok: true, id: id, page: pageUrl, discord: { flux: flux, message: messageDiscord(v, date, pageUrl) } };
}

function lireChamps(d, flux) {
  const titre = String(d.titre || '').trim().slice(0, 200);
  const texte = String(d.texte || '').trim().slice(0, 20000);
  if (!titre || !texte) return { erreur: 'vide' };
  if (d.couverture && d.couverture !== 'garder' && !TYPES_PHOTO.includes(d.couverture.mime)) return { erreur: 'photo' };
  return { titre: titre, texte: texte, type: TYPES[flux].includes(d.type) ? d.type : 'Général' };
}

// Retrouve une publication par son id (colonne « ID réponse ») dans l'un des deux fils.
function trouverPublication(id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  for (const flux of ['NOUVELLES', 'ANNONCES']) {
    const onglet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(flux);
    if (!onglet || onglet.getLastRow() < 2) continue;
    const lignes = onglet.getRange(2, 1, onglet.getLastRow() - 1, ENTETES.length).getValues();
    const i = lignes.findIndex(l => String(l[9]) === id);
    if (i >= 0) return { flux: flux, onglet: onglet, rangee: i + 2, l: lignes[i] };
  }
  return null;
}

// Seuls les dirigeants (case « Annonces » de l'onglet ACCES) modifient les publications.
function peutModifier(membre) {
  return membre.annonces === true;
}

// Dirigeants : les publications les plus récentes des deux fils, pour choisir laquelle modifier.
function recentes(membre) {
  if (!peutModifier(membre)) return { ok: false, erreur: 'dirigeant' };
  const liste = [];
  ['NOUVELLES', 'ANNONCES'].forEach(flux => {
    const onglet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(flux);
    if (!onglet || onglet.getLastRow() < 2) return;
    onglet.getRange(2, 1, onglet.getLastRow() - 1, ENTETES.length).getValues().forEach(l => {
      if (l[9] && l[3]) liste.push({ id: String(l[9]), flux: flux, titre: String(l[3]), equipe: String(l[1]), date: new Date(l[0]).getTime() || 0 });
    });
  });
  liste.sort((a, b) => b.date - a.date);
  return { ok: true, publications: liste.slice(0, 20) };
}

function lire(d, membre) {
  const id = String(d.id || '');
  if (!peutModifier(membre)) return { ok: false, erreur: 'dirigeant' };
  const pub = trouverPublication(id);
  if (!pub) return { ok: false, erreur: 'introuvable' };
  const photo = String(pub.l[5]).split(',').filter(String)[0] || '';
  return {
    ok: true, id: id, flux: pub.flux, equipe: pub.l[1], type: pub.l[2], titre: pub.l[3], texte: pub.l[4],
    couverture: photo ? urlPhoto(photo) : '',
  };
}

// d.couverture : 'garder' (inchangée), null (retirée) ou une nouvelle image.
function modifier(d, membre) {
  const id = String(d.id || '');
  if (!peutModifier(membre)) return { ok: false, erreur: 'dirigeant' };
  const pub = trouverPublication(id);
  if (!pub) return { ok: false, erreur: 'introuvable' };
  const champs = lireChamps(d, pub.flux);
  if (champs.erreur) return { ok: false, erreur: champs.erreur };

  const anciennes = String(pub.l[5]).split(',').filter(String);
  const photos = d.couverture === 'garder' ? anciennes : d.couverture ? [enregistrerPhoto(d.couverture)] : [];
  // Colonnes C à F : Type, Titre, Texte, Photos. L'équipe et la date d'origine restent.
  pub.onglet.getRange(pub.rangee, 3, 1, 4).setValues([[champs.type, champs.titre, champs.texte, photos.join(',')]]);
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONGLET_JOURNAL)
    .appendRow([new Date(), membre.courriel, pub.flux, 'Modification : ' + champs.titre, id, '']);

  const pageUrl = lienPage(pub.flux, id);
  const v = { titre: champs.titre, texte: champs.texte, type: champs.type, equipe: pub.l[1], photos: photos };
  return {
    ok: true, id: id, page: pageUrl,
    discord: { flux: pub.flux, idDiscord: String(pub.l[8] || ''), message: messageDiscord(v, new Date(pub.l[0]), pageUrl) },
  };
}

// Le Worker rapporte le résultat de l'envoi à Discord : id du message dans la
// colonne « ID Discord », ou raison du refus dans le JOURNAL (colonne F).
function noterDiscord(d, membre) {
  const flux = d.flux === 'ANNONCES' ? 'ANNONCES' : 'NOUVELLES';
  const id = String(d.id || '');
  const journal = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONGLET_JOURNAL);
  const entrees = journal.getDataRange().getValues();
  const j = entrees.findIndex(l => String(l[4]) === id);
  // Seul l'auteur de la publication (ou un dirigeant) peut noter son résultat.
  if (!id || j < 1 || (entrees[j][1] !== membre.courriel && !membre.annonces)) return { ok: false, erreur: 'acces' };
  journal.getRange(j + 1, 6).setValue(d.erreur ? String(d.erreur).slice(0, 500) : '');
  const idDiscord = String(d.idDiscord || '').replace(/\D/g, '');
  if (idDiscord) {
    const onglet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(flux);
    const ids = onglet.getRange(1, 10, onglet.getLastRow(), 1).getValues().map(l => String(l[0]));
    const ligne = ids.indexOf(id);
    if (ligne > 0) onglet.getRange(ligne + 1, 9).setValue(idDiscord);
  }
  return { ok: true };
}

// Dirigeants seulement : la dernière publication visible de chaque fil qui n'est
// pas arrivée sur Discord, prête à être renvoyée par le Worker.
function enAttente(membre) {
  if (!membre.annonces) return { ok: false, erreur: 'annonces' };
  const attente = [];
  ['NOUVELLES', 'ANNONCES'].forEach(flux => {
    const onglet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(flux);
    if (!onglet || onglet.getLastRow() < 2) return;
    const lignes = onglet.getRange(2, 1, onglet.getLastRow() - 1, ENTETES.length).getValues();
    const i = lignes.map(l => !l[8] && l[6] === true && !!l[9]).lastIndexOf(true);
    if (i < 0) return;
    const l = lignes[i];
    const v = { equipe: l[1], type: l[2], titre: l[3], texte: l[4], photos: String(l[5]).split(',').filter(String) };
    const pageUrl = lienPage(flux, l[9]);
    attente.push({ flux: flux, id: String(l[9]), titre: v.titre, message: messageDiscord(v, new Date(l[0]), pageUrl) });
  });
  return { ok: true, attente: attente };
}

function enregistrerPhoto(photo) {
  const octets = Utilities.base64Decode(String(photo.data || ''));
  if (!octets.length || octets.length > MAX_OCTETS_PHOTO) throw new Error('Photo vide ou trop lourde');
  const fichier = dossierPhotos().createFile(Utilities.newBlob(octets, photo.mime, 'photo-' + Date.now()));
  fichier.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return fichier.getId();
}

function dossierPhotos() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DOSSIER_PHOTOS');
  if (id) return DriveApp.getFolderById(id);
  const dossier = DriveApp.createFolder('LNHQ — Photos des nouvelles');
  props.setProperty('DOSSIER_PHOTOS', dossier.getId());
  return dossier;
}

function ouvrirOnglet(nom) {
  const classeur = SpreadsheetApp.openById(SHEET_ID);
  const onglet = classeur.getSheetByName(nom) || classeur.insertSheet(nom);
  if (onglet.getLastRow() === 0) {
    onglet.appendRow(ENTETES);
    onglet.setFrozenRows(1);
    // Format texte forcé : l'API lue par le site devine un seul type par colonne et
    // efface silencieusement les valeurs qui ne correspondent pas (ex. un titre « 2026 »).
    onglet.getRange('B:F').setNumberFormat('@');
    onglet.getRange('I:J').setNumberFormat('@');
  }
  return onglet;
}

// Corps du message Discord (envoyé par le Worker vers le webhook du fil).
// Un aperçu seulement : la bannière en haut (1er embed, image seule), puis le titre,
// les premières lignes et un lien vers l'article complet sur le site.
function messageDiscord(v, date, pageUrl) {
  const couleur = COULEURS_TYPE[v.type] || COULEURS_TYPE['Général'];
  // Bannière : la couverture, sinon la première image placée dans le texte.
  // (une photo envoyée, jamais un logo d'équipe inséré avec le bouton « Logo »)
  const dansLeTexte = /!\[[^\]]*\]\((https:\/\/lh3\.googleusercontent\.com\/[^)\s#]+)/.exec(v.texte);
  const banniere = v.photos.length ? urlPhoto(v.photos[0]) : (dansLeTexte ? dansLeTexte[1] : '');
  const embeds = [];
  if (banniere) embeds.push({ color: couleur, image: { url: banniere } });
  embeds.push({
    title: tronquer(v.titre, 256),
    url: pageUrl,
    description: apercuDiscord(v.texte) + '\n\n[**Lire la suite →**](' + pageUrl + ')',
    color: couleur,
    footer: { text: v.type + ' · ' + v.equipe },
    timestamp: date.toISOString(),
  });
  // Nom et avatar affichés dans Discord à la place du nom du webhook : l'équipe
  // (avec son logo) pour une nouvelle, la ligue pour une annonce.
  const code = CODES_EQUIPES[v.equipe];
  return {
    username: code ? v.equipe + ' · LNHQ' : v.equipe === SIGNATURE_ANNONCES ? 'Commissaire · LNHQ' : 'LNHQ',
    avatar_url: code ? 'https://lnhq.ca/Logos/' + code + '.png' : 'https://lnhq.ca/logo-lnhq.png',
    embeds: embeds,
    // Aucune mention (@everyone, @here, rôles) possible depuis le texte d'une nouvelle.
    allowed_mentions: { parse: [] },
  };
}

const APERCU_LIGNES = 4;
const APERCU_CARACTERES = 350;

// Premières lignes du texte, sans images, couleurs ni tableaux (que Discord
// n'affiche pas) ; les titres deviennent du gras.
function apercuDiscord(texte) {
  const lignes = texte
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<\/?span[^>]*>|<br\s*\/?>/gi, '')
    .replace(/(^\|.*\|[ \t]*$\n?)+/gm, '')
    .replace(/^#{1,6}\s+(.+)$/gm, '**$1**')
    .replace(/^>\s?/gm, '')
    .split('\n').map(l => l.trim()).filter(Boolean);
  let apercu = lignes.slice(0, APERCU_LIGNES).join('\n\n');
  if (apercu.length > APERCU_CARACTERES) {
    apercu = apercu.slice(0, APERCU_CARACTERES).replace(/\s+\S*$/, '') + '…';
  } else if (lignes.length > APERCU_LIGNES) {
    apercu += '…';
  }
  return apercu;
}

// Lien d'une publication sur le site (page d'accueil, onglet de son fil).
function lienPage(flux, id) {
  return 'https://lnhq.ca/?fil=' + flux.toLowerCase() + '#n-' + id;
}

function urlPhoto(id) {
  return 'https://lh3.googleusercontent.com/d/' + id + '=w1600';
}

function tronquer(texte, max) {
  return texte.length > max ? texte.slice(0, max - 1) + '…' : texte;
}

/* =========================================================================
   ENCHÈRES DES AGENTS LIBRES (lnhq.ca/encheres.html, mises sur publier.lnhq.ca)

   Onglets du classeur public (créés par installer) :
     ENCHERES  une ligne par enchère ;  MISES  l'historique de chaque mise ;
     JETONS    jetons de départ de chaque équipe pour la saison (modifiable par
               les dirigeants : pénalité, bonus, nouvelle saison).
   Agents libres : lignes de PLAYERSDATABASE dont la colonne Z (LNHQ TM) vaut
   « UFA ». À la fin d'une enchère, Z prend le code de l'équipe gagnante.
   Jetons disponibles = départ − enchères gagnées − enchères où l'équipe est en tête.
   Seuls les dirigeants corrigent ou annulent (directement dans le classeur :
   Statut « Annulée » rend les jetons).
   ========================================================================= */
const ONGLET_JOUEURS = 'PLAYERSDATABASE';
const COL_JOUEUR = 2;           // B  JOUEUR
const COL_EQUIPE_JOUEUR = 26;   // Z  LNHQ TM
const STATUT_UFA = 'UFA';
const ENCHERES_ENTETES = ['ID', 'Joueur', 'Naissance', 'Position', 'OV', 'Équipe en tête', 'Mise', 'Nb mises', 'Début', 'Fin', 'Statut', 'Saison', 'Lancée par'];
const MISES_ENTETES = ['Date', 'ID enchère', 'Joueur', 'Équipe', 'Mise'];
const JETONS_ENTETES = ['Équipe', 'Code', 'Jetons de départ', 'Saison'];
const MISE_MINIMALE = 50;
const SURENCHERE_MINIMALE = 20;
const HEURES_LANCEMENT = 24;
const HEURES_RELANCE = 12;
const JETONS_PAR_SAISON = 1000;
const SAISON_DEPART = '2026-27';
const EN_COURS = 'En cours';

/* =========================================================================
   CHOIX DE REPÊCHAGE : une ligne par choix dans PLAYERSDATABASE, comme un joueur.
     B (et A)  « 1re ronde 2027 (MTL) » : ronde, année, équipe d'ORIGINE
     H et I    « CHOIX » : exclu des sections Attaquants/Défenseurs/Gardiens
     Z         équipe PROPRIÉTAIRE (valeur, pas la formule du DRAFT) : un échange
               = changer ce code.
   Chaque onglet d'équipe liste ses choix sous l'en-tête CHOIX (formule FILTER).
   À lancer à la main (Exécuter) ; relançable sans créer de doublons.
   ========================================================================= */
const ANNEE_CHOIX = '2027';
const RONDES_CHOIX = ['1re', '2e'];

function installerChoix() {
  const classeur = SpreadsheetApp.openById(SHEET_ID);
  const pdb = classeur.getSheetByName(ONGLET_JOUEURS);
  const existants = new Set(pdb.getRange(3, COL_JOUEUR, pdb.getLastRow() - 2, 1).getValues().map(l => String(l[0]).trim()));
  const lignes = [];
  EQUIPES.forEach(nom => {
    const code = CODES_EQUIPES[nom];
    RONDES_CHOIX.forEach(ronde => {
      const libelle = ronde + ' ronde ' + ANNEE_CHOIX + ' (' + code + ')';
      if (existants.has(libelle)) return;
      const l = new Array(COL_EQUIPE_JOUEUR).fill('');
      l[0] = libelle;                  // A
      l[COL_JOUEUR - 1] = libelle;     // B
      l[7] = 'CHOIX';                  // H  PO
      l[8] = 'CHOIX';                  // I  PO2
      l[COL_EQUIPE_JOUEUR - 1] = code; // Z  propriétaire
      lignes.push(l);
    });
  });
  if (lignes.length) {
    const debut = pdb.getLastRow() + 1;
    const manque = debut + lignes.length - 1 - pdb.getMaxRows();
    if (manque > 0) pdb.insertRowsAfter(pdb.getMaxRows(), manque);
    pdb.getRange(debut, 1, lignes.length, COL_EQUIPE_JOUEUR).setValues(lignes);
  }
  console.log(lignes.length + ' choix ajoutés à ' + ONGLET_JOUEURS + '.');

  const formule = '=IFERROR(SORT(FILTER(PLAYERSDATABASE!$B$3:$B$2686, PLAYERSDATABASE!$Z$3:$Z$2686=$A$1, '
    + 'PLAYERSDATABASE!$H$3:$H$2686="CHOIX")), "")';
  Object.values(CODES_EQUIPES).forEach(code => {
    const o = classeur.getSheetByName(code);
    if (!o) { console.warn('Onglet ' + code + ' introuvable'); return; }
    const b = o.getRange(1, 2, o.getMaxRows(), 1).getValues();
    const i = b.findIndex(l => String(l[0]).trim() === 'CHOIX');
    if (i < 0) { console.warn(code + ' : en-tête CHOIX introuvable'); return; }
    const cible = o.getRange(i + 2, 2);
    // On n'écrase pas une liste tapée à la main sous CHOIX.
    const dessous = o.getRange(i + 2, 2, Math.min(10, o.getMaxRows() - i - 1), 1).getValues().flat().filter(String);
    if (dessous.length && !cible.getFormula()) { console.warn(code + ' : cases sous CHOIX déjà remplies, formule non posée'); return; }
    cible.setFormula(formule);
  });
  console.log('Formule CHOIX posée dans les onglets d\'équipe.');
}

function installerEncheres() {
  const classeur = SpreadsheetApp.openById(SHEET_ID);
  [['ENCHERES', ENCHERES_ENTETES], ['MISES', MISES_ENTETES]].forEach(([nom, entetes]) => {
    if (classeur.getSheetByName(nom)) return;
    const o = classeur.insertSheet(nom);
    o.appendRow(entetes);
    o.setFrozenRows(1);
    // Format texte sur les colonnes entières : sinon le classeur transforme les dates ISO
    // en dates locales et le site ne sait plus quand finit une enchère.
    o.getRange(1, 1, o.getMaxRows(), entetes.length).setNumberFormat('@');
  });
  if (!classeur.getSheetByName('JETONS')) {
    const o = classeur.insertSheet('JETONS');
    o.appendRow(JETONS_ENTETES);
    o.setFrozenRows(1);
    EQUIPES.forEach(nom => o.appendRow([nom, CODES_EQUIPES[nom], JETONS_PAR_SAISON, SAISON_DEPART]));
    o.getRange('D:D').setNumberFormat('@');
  }
}

function ongletEncheres(nom) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(nom);
}

function lireEncheres() {
  const o = ongletEncheres('ENCHERES');
  if (o.getLastRow() < 2) return [];
  return o.getRange(2, 1, o.getLastRow() - 1, ENCHERES_ENTETES.length).getDisplayValues().map((l, i) => ({
    rangee: i + 2, id: l[0], joueur: l[1], naissance: l[2], position: l[3], ov: l[4],
    equipe: l[5], mise: Number(l[6]) || 0, nb: Number(l[7]) || 0, debut: l[8], fin: l[9],
    statut: l[10], saison: l[11],
  })).filter(e => e.id);
}

// Jetons de départ et saison courante, lus dans l'onglet JETONS.
function lireJetons() {
  const o = ongletEncheres('JETONS');
  const depart = {};
  let saison = SAISON_DEPART;
  if (o && o.getLastRow() >= 2) {
    o.getRange(2, 1, o.getLastRow() - 1, 4).getDisplayValues().forEach(l => {
      if (l[1]) depart[l[1].trim().toUpperCase()] = Number(String(l[2]).replace(/[^\d-]/g, '')) || 0;
      if (l[3]) saison = l[3].trim();
    });
  }
  return { depart: depart, saison: saison };
}

function jetonsEquipe(code, encheres, config) {
  const depart = config.depart[code] != null ? config.depart[code] : JETONS_PAR_SAISON;
  let depenses = 0, engages = 0;
  encheres.filter(e => e.saison === config.saison && e.equipe === code).forEach(e => {
    if (e.statut === 'Terminée') depenses += e.mise;
    else if (e.statut === EN_COURS) engages += e.mise;
  });
  return { depart: depart, depenses: depenses, engages: engages, disponibles: depart - depenses - engages };
}

// Agent libre : même nom (colonne B) et « UFA » en colonne Z. La date de naissance,
// si fournie, départage deux joueurs du même nom.
function trouverAgentLibre(nom, naissance) {
  const o = ongletEncheres(ONGLET_JOUEURS);
  const valeurs = o.getRange(2, COL_JOUEUR, o.getLastRow() - 1, COL_EQUIPE_JOUEUR - COL_JOUEUR + 1).getDisplayValues();
  const iNaissance = 5 - COL_JOUEUR; // E  Birthdate
  const iEquipe = COL_EQUIPE_JOUEUR - COL_JOUEUR;
  const i = valeurs.findIndex(l => l[0].trim() === nom && l[iEquipe].trim().toUpperCase() === STATUT_UFA
    && (!naissance || l[iNaissance].trim() === naissance));
  if (i < 0) return null;
  const l = valeurs[i];
  return { rangee: i + 2, nom: l[0].trim(), naissance: l[iNaissance].trim(), position: l[8 - COL_JOUEUR].trim(), ov: l[3 - COL_JOUEUR].trim() };
}

function codeDuMembre(membre) {
  return CODES_EQUIPES[membre.equipe] || '';
}

function lancerEnchere(d, membre) {
  const code = codeDuMembre(membre);
  if (!code) return { ok: false, erreur: 'equipe' };
  const montant = Math.floor(Number(d.montant));
  if (!(montant >= MISE_MINIMALE)) return { ok: false, erreur: 'minimum', minimum: MISE_MINIMALE };
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const joueur = trouverAgentLibre(String(d.joueur || '').trim(), String(d.naissance || '').trim());
    if (!joueur) return { ok: false, erreur: 'joueur' };
    const encheres = lireEncheres();
    if (encheres.some(e => e.statut === EN_COURS && e.joueur === joueur.nom && e.naissance === joueur.naissance)) {
      return { ok: false, erreur: 'deja' };
    }
    const config = lireJetons();
    const j = jetonsEquipe(code, encheres, config);
    if (j.disponibles < montant) return { ok: false, erreur: 'jetons', disponibles: j.disponibles };

    const maintenant = new Date();
    const e = {
      id: Utilities.getUuid().slice(0, 8), joueur: joueur.nom, naissance: joueur.naissance,
      position: joueur.position, ov: joueur.ov, equipe: code, mise: montant, nb: 1,
      debut: maintenant.toISOString(), fin: new Date(maintenant.getTime() + HEURES_LANCEMENT * 3600000).toISOString(),
      statut: EN_COURS, saison: config.saison,
    };
    ongletEncheres('ENCHERES').appendRow([e.id, e.joueur, e.naissance, e.position, e.ov, e.equipe, e.mise, e.nb,
      e.debut, e.fin, e.statut, e.saison, code]);
    ongletEncheres('MISES').appendRow([e.debut, e.id, e.joueur, code, montant]);
    return { ok: true, id: e.id, discord: { flux: 'AGENTS', message: messageEnchere('nouvelle', e) } };
  } finally {
    verrou.releaseLock();
  }
}

function miserEnchere(d, membre) {
  const code = codeDuMembre(membre);
  if (!code) return { ok: false, erreur: 'equipe' };
  const montant = Math.floor(Number(d.montant));
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const encheres = lireEncheres();
    const e = encheres.find(x => x.id === String(d.id || ''));
    const maintenant = new Date();
    if (!e || e.statut !== EN_COURS || new Date(e.fin) <= maintenant) return { ok: false, erreur: 'terminee' };
    if (e.equipe === code) return { ok: false, erreur: 'en_tete' };
    // Vérifié ici, sous verrou : une mise envoyée juste avant la nôtre a pu changer le minimum.
    const minimum = e.mise + SURENCHERE_MINIMALE;
    if (!(montant >= minimum)) return { ok: false, erreur: 'minimum', minimum: minimum };
    const j = jetonsEquipe(code, encheres, lireJetons());
    if (j.disponibles < montant) return { ok: false, erreur: 'jetons', disponibles: j.disponibles };

    const precedente = e.equipe;
    // Le chrono repart à 12 h, sauf s'il restait déjà plus que ça.
    const relance = new Date(maintenant.getTime() + HEURES_RELANCE * 3600000);
    e.fin = (new Date(e.fin) > relance ? new Date(e.fin) : relance).toISOString();
    e.equipe = code;
    e.mise = montant;
    e.nb += 1;
    ongletEncheres('ENCHERES').getRange(e.rangee, 6, 1, 5).setValues([[e.equipe, e.mise, e.nb, e.debut, e.fin]]);
    ongletEncheres('MISES').appendRow([maintenant.toISOString(), e.id, e.joueur, code, montant]);
    return { ok: true, id: e.id, discord: { flux: 'AGENTS', message: messageEnchere('surenchere', e, precedente) } };
  } finally {
    verrou.releaseLock();
  }
}

// Ferme les enchères dont le chrono est écoulé : le joueur passe à l'équipe gagnante
// (colonne Z de PLAYERSDATABASE). Renvoie les messages Discord à publier.
function cloturerEncheres() {
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const maintenant = new Date();
    const aFermer = lireEncheres().filter(e => e.statut === EN_COURS && new Date(e.fin) <= maintenant);
    const messages = [];
    aFermer.forEach(e => {
      const joueur = trouverAgentLibre(e.joueur, e.naissance);
      if (joueur) ongletEncheres(ONGLET_JOUEURS).getRange(joueur.rangee, COL_EQUIPE_JOUEUR).setValue(e.equipe);
      else console.warn('Joueur introuvable (plus UFA ?) : ' + e.joueur);
      e.statut = 'Terminée';
      ongletEncheres('ENCHERES').getRange(e.rangee, 11).setValue(e.statut);
      messages.push({ flux: 'AGENTS', message: messageEnchere('fin', e, '', !joueur) });
    });
    return { ok: true, fermees: aFermer.length, messages: messages };
  } finally {
    verrou.releaseLock();
  }
}

function nomEquipe(code) {
  return Object.keys(CODES_EQUIPES).find(nom => CODES_EQUIPES[nom] === code) || code;
}

function messageEnchere(type, e, precedente, joueurIntrouvable) {
  const fin = Math.floor(new Date(e.fin).getTime() / 1000);
  const joueur = e.joueur + (e.position || e.ov ? ' (' + [e.position, e.ov ? e.ov + ' OV' : ''].filter(String).join(', ') + ')' : '');
  const lignes = {
    nouvelle: [
      '**' + nomEquipe(e.equipe) + '** lance une enchère sur **' + joueur + '**.',
      'Mise de départ : **' + e.mise + ' jetons**',
      'Prochaine mise minimale : ' + (e.mise + SURENCHERE_MINIMALE) + ' jetons',
      'Fin : <t:' + fin + ':f> (<t:' + fin + ':R>)',
    ],
    surenchere: [
      '**' + nomEquipe(e.equipe) + '** mise **' + e.mise + ' jetons** sur **' + joueur + '**'
        + (precedente ? ' et devance ' + nomEquipe(precedente) : '') + '.',
      'Prochaine mise minimale : ' + (e.mise + SURENCHERE_MINIMALE) + ' jetons',
      'Fin : <t:' + fin + ':f> (<t:' + fin + ':R>)',
    ],
    fin: [
      '**' + nomEquipe(e.equipe) + '** remporte **' + joueur + '** pour **' + e.mise + ' jetons**'
        + ' (' + e.nb + ' mise' + (e.nb > 1 ? 's' : '') + ').',
    ].concat(joueurIntrouvable ? ['⚠️ Joueur introuvable en UFA dans PLAYERSDATABASE : à inscrire à la main.'] : []),
  }[type];
  const titre = { nouvelle: '🆕 Nouvelle enchère', surenchere: '⬆️ Surenchère', fin: '🏁 Enchère terminée' }[type];
  return {
    username: 'Agents libres · LNHQ',
    avatar_url: 'https://lnhq.ca/logo-lnhq.png',
    embeds: [{
      title: titre + ' : ' + e.joueur,
      url: 'https://lnhq.ca/encheres.html#e-' + e.id,
      description: lignes.join('\n'),
      color: type === 'fin' ? 0x2F9E44 : 0xE8590C,
      thumbnail: { url: 'https://lnhq.ca/Logos/' + e.equipe + '.png' },
    }],
    allowed_mentions: { parse: [] },
  };
}
