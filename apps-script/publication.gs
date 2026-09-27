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
  const dansLeTexte = /!\[[^\]]*\]\((https:\/\/[^)\s#]+)/.exec(v.texte);
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
  return 'https://lnhq.ca/accueil.html?fil=' + flux.toLowerCase() + '#n-' + id;
}

function urlPhoto(id) {
  return 'https://lh3.googleusercontent.com/d/' + id + '=w1600';
}

function tronquer(texte, max) {
  return texte.length > max ? texte.slice(0, max - 1) + '…' : texte;
}
