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
  NOUVELLES: ['Général', 'Transaction', 'Résultat', 'Blessure', 'Chronique'],
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
  'Transaction': 0x1C7ED6, 'Résultat': 0x2F9E44, 'Blessure': 0xE03131, 'Général': 0xE8590C, 'Chronique': 0xC2255C,
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
  ongletGardiens();
  ongletResultats();
  dossierResultats();
  ongletAlignements();
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
  if (p.action === 'tirerAuSortAuto') return tirerAuSortAuto();
  // Chaque jour (tâche planifiée du Worker) : rappels et fins de période du 2e gardien.
  if (p.action === 'rappelsGardiens') return rappelsGardiens();
  // Page d'inscription publique (par le Worker api.lnhq.ca), sans membre connecté.
  if (p.action === 'inscrire') return inscrire(JSON.parse(corps || '{}'));
  if (p.action === 'statutInscription') return statutInscription(JSON.parse(corps || '{}'));
  if (p.action === 'equipesInscrites') return equipesInscrites();
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
  if (p.action === 'declarerGardien') return declarerGardien(JSON.parse(corps || '{}'), membre);
  if (p.action === 'retirerGardien') return retirerGardien(JSON.parse(corps || '{}'), membre);
  if (p.action === 'soumettreResultat') return soumettreResultat(JSON.parse(corps || '{}'), membre);
  if (p.action === 'sauverAlignement') return sauverAlignement(JSON.parse(corps || '{}'), membre);
  if (p.action === 'lancerEnchere') return lancerEnchere(JSON.parse(corps || '{}'), membre);
  if (p.action === 'miserEnchere') return miserEnchere(JSON.parse(corps || '{}'), membre);
  if (p.action === 'tirerAuSort') return tirerAuSort(JSON.parse(corps || '{}'), membre);
  if (p.action === 'programmerTirage') return programmerTirage(JSON.parse(corps || '{}'), membre);
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
  // Colonne D (Statut) : vide ou « Approuvé » = accès ; « À approuver » (inscription
  // du site pas encore validée) ou « Refusé » = aucun droit.
  if (!ligne || !estApprouve(ligne[3])) return null;
  return { courriel: cherche, equipe: String(ligne[1] || '').trim() || 'Ligue', annonces: ligne[2] === true };
}

/* =========================================================================
   INSCRIPTIONS (lnhq.ca/inscription.html, par l'API publique api.lnhq.ca)
   Une demande ajoute une ligne dans ACCES avec le statut « À approuver ».
   Pour approuver : vider la colonne Statut (ou écrire « Approuvé »), puis
   ajouter le courriel dans Cloudflare Access. Aucun courriel n'est renvoyé au site.
   ========================================================================= */
const ACCES_ENTETES = ['Courriel', 'Équipe', 'Annonces', 'Statut', 'Demandé le'];
const A_APPROUVER = 'À approuver';
const MAX_EN_ATTENTE = 100;

function estApprouve(statut) {
  const s = String(statut || '').trim().toLowerCase();
  return s === '' || s === 'approuvé' || s === 'approuve';
}

function ongletAcces() {
  const o = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONGLET_ACCES);
  // Ajoute les colonnes d'inscription aux en-têtes existants (Courriel, Équipe, Annonces).
  const entetes = o.getRange(1, 1, 1, ACCES_ENTETES.length).getValues()[0];
  if (entetes[3] !== ACCES_ENTETES[3]) o.getRange(1, 1, 1, ACCES_ENTETES.length).setValues([ACCES_ENTETES]);
  return o;
}

function inscrire(d) {
  const courriel = String(d.courriel || '').trim().toLowerCase();
  const equipe = String(d.equipe || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(courriel) || courriel.length > 120) return { ok: false, erreur: 'courriel' };
  if (!EQUIPES.includes(equipe)) return { ok: false, erreur: 'equipe' };
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const o = ongletAcces();
    const lignes = o.getDataRange().getValues().slice(1);
    const existante = lignes.find(l => String(l[0]).trim().toLowerCase() === courriel);
    if (existante) return { ok: true, statut: statutDe(existante), deja: true };
    // Une équipe déjà inscrite (approuvée ou en attente) ne peut pas être redemandée.
    if (lignes.some(l => String(l[1]).trim() === equipe && String(l[0]).trim() && statutDe(l) !== 'refuse')) return { ok: false, erreur: 'equipe_prise' };
    if (lignes.filter(l => String(l[3]).trim() === A_APPROUVER).length >= MAX_EN_ATTENTE) return { ok: false, erreur: 'plein' };
    // Première ligne sans courriel sous la liste : les cases à cocher de la colonne C
    // (jusqu'à la ligne 200) font croire au classeur que ces lignes sont remplies, et
    // appendRow écrirait sous la ligne 200, loin de la liste.
    const libre = lignes.findIndex(l => !String(l[0]).trim());
    const rangee = libre >= 0 ? libre + 2 : o.getLastRow() + 1;
    o.getRange(rangee, 1, 1, 2).setValues([[courriel, equipe]]);
    o.getRange(rangee, 4, 1, 2).setValues([[A_APPROUVER, new Date()]]);
    const caseAnnonces = o.getRange(rangee, 3);
    if (caseAnnonces.getDataValidation() === null) caseAnnonces.insertCheckboxes();
    return { ok: true, statut: 'attente' };
  } finally {
    verrou.releaseLock();
  }
}

function statutDe(ligne) {
  if (estApprouve(ligne[3])) return 'approuve';
  return String(ligne[3]).trim().toLowerCase().indexOf('refus') === 0 ? 'refuse' : 'attente';
}

function statutInscription(d) {
  const courriel = String(d.courriel || '').trim().toLowerCase();
  const ligne = ongletAcces().getDataRange().getValues().slice(1).find(l => String(l[0]).trim().toLowerCase() === courriel);
  return { ok: true, statut: ligne ? statutDe(ligne) : 'inconnu', equipe: ligne ? String(ligne[1] || '') : '' };
}

// Pour chaque équipe : nombre de comptes approuvés et en attente (jamais les courriels).
function equipesInscrites() {
  const compte = {};
  EQUIPES.forEach(nom => { compte[nom] = { equipe: nom, code: CODES_EQUIPES[nom], approuves: 0, attente: 0 }; });
  ongletAcces().getDataRange().getValues().slice(1).forEach(l => {
    const c = compte[String(l[1]).trim()];
    if (!c || !String(l[0]).trim()) return;
    const s = statutDe(l);
    if (s === 'approuve') c.approuves++;
    else if (s === 'attente') c.attente++;
  });
  return { ok: true, equipes: EQUIPES.map(nom => compte[nom]) };
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

const TEXTE_MAX = 45000;   // même valeur dans publier/public/publier.js

function lireChamps(d, flux) {
  const titre = String(d.titre || '').trim().slice(0, 200);
  const texte = String(d.texte || '').trim();
  if (!titre || !texte) return { erreur: 'vide' };
  // Une cellule Google Sheets accepte 50 000 caractères : on refuse au-delà de TEXTE_MAX
  // plutôt que de couper le texte sans prévenir.
  if (texte.length > TEXTE_MAX) return { erreur: 'long', maximum: TEXTE_MAX, longueur: texte.length };
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
   Jetons disponibles = départ − enchères gagnées − enchères où l'équipe est en tête
   (ou à égalité à 1000, jusqu'au tirage).
   Mise maximale : 1000 (le budget d'une saison). Dès 981, la mise suivante est 1000 ;
   à 1000, d'autres équipes peuvent miser 1000 elles aussi (colonne « Égalité »), sans
   relancer le chrono. À la fin, s'il y a égalité, l'enchère passe en « Tirage » : un
   admin clique « Tirer au sort » sur publier.lnhq.ca ; les perdants retrouvent leurs jetons.
   Aucune enchère avant OUVERTURE_ENCHERES.
   Seuls les dirigeants corrigent ou annulent (directement dans le classeur :
   Statut « Annulée » rend les jetons).
   ========================================================================= */
const ONGLET_JOUEURS = 'PLAYERSDATABASE';
const COL_JOUEUR = 2;           // B  JOUEUR
const COL_EQUIPE_JOUEUR = 26;   // Z  LNHQ TM
const STATUT_UFA = 'UFA';
const ENCHERES_ENTETES = ['ID', 'Joueur', 'Naissance', 'Position', 'OV', 'Équipe en tête', 'Mise', 'Nb mises', 'Début', 'Fin', 'Statut', 'Saison', 'Lancée par', 'Égalité', 'Tirage prévu'];
const COL_EGALITE = 14;         // N : équipes à égalité à 1000 (codes séparés par des virgules)
const COL_TIRAGE_PREVU = 15;    // O : heure du tirage au sort programmé (ISO), lancé par le Worker
const MISES_ENTETES = ['Date', 'ID enchère', 'Joueur', 'Équipe', 'Mise'];
const JETONS_ENTETES = ['Équipe', 'Code', 'Jetons de départ', 'Saison'];
const MISE_MINIMALE = 50;
const SURENCHERE_MINIMALE = 20;
const HEURES_LANCEMENT = 24;
const HEURES_RELANCE = 12;
const JETONS_PAR_SAISON = 1000;
const MISE_MAXIMALE = 1000;
const SAISON_DEPART = '2026-27';
const EN_COURS = 'En cours';
const TIRAGE = 'Tirage';
// Ouverture : mardi 6 octobre 2026, 19 h heure de l'Est (UTC−4 en octobre).
const OUVERTURE_ENCHERES = new Date('2026-10-06T23:00:00Z');

/* =========================================================================
   2e GARDIEN : chaque équipe le fait jouer au moins une fois par période de
   2 semaines (périodes de l'onglet SCHEDULE, séparées par une ligne « Time »).
   Le DG déclare le match (publier.lnhq.ca/gardien.html), d'avance s'il veut ;
   il peut changer ou retirer son choix jusqu'à la fin de la période, ensuite
   elle est verrouillée. Onglet public GARDIENS : une ligne par équipe et période.
   Rappel Discord 3 jours avant la fin d'une période, et liste des équipes
   illégales le lendemain de la fin (WEBHOOK_GARDIENS du Worker).
   ========================================================================= */
const ONGLET_CALENDRIER = 'SCHEDULE';
const ONGLET_GARDIENS = 'GARDIENS';
const GARDIENS_ENTETES = ['Équipe', 'Période', 'Match', 'Date', 'Adversaire', 'Déclaré le'];
const JOURS_RAPPEL = 3;
// Nom complet du calendrier → code d'équipe.
const CODES_NOMS_COMPLETS = {
  'anaheim ducks': 'ANA', 'boston bruins': 'BOS', 'buffalo sabres': 'BUF', 'calgary flames': 'CGY',
  'carolina hurricanes': 'CAR', 'chicago blackhawks': 'CHI', 'colorado avalanche': 'COL', 'columbus blue jackets': 'CBJ',
  'dallas stars': 'DAL', 'detroit red wings': 'DET', 'edmonton oilers': 'EDM', 'florida panthers': 'FLA',
  'los angeles kings': 'LAK', 'minnesota wild': 'MIN', 'montréal canadiens': 'MTL', 'montreal canadiens': 'MTL',
  'nashville predators': 'NSH', 'new jersey devils': 'NJD', 'new york islanders': 'NYI', 'new york rangers': 'NYR',
  'ottawa senators': 'OTT', 'philadelphia flyers': 'PHI', 'pittsburgh penguins': 'PIT', 'san jose sharks': 'SJS',
  'seattle kraken': 'SEA', 'st. louis blues': 'STL', 'st louis blues': 'STL', 'tampa bay lightning': 'TBL',
  'toronto maple leafs': 'TOR', 'utah mammoth': 'UTA', 'utah hockey club': 'UTA', 'vancouver canucks': 'VAN',
  'vegas golden knights': 'VGK', 'washington capitals': 'WSH', 'winnipeg jets': 'WPG',
};

function ongletGardiens() {
  const classeur = SpreadsheetApp.openById(SHEET_ID);
  let o = classeur.getSheetByName(ONGLET_GARDIENS);
  if (!o) {
    o = classeur.insertSheet(ONGLET_GARDIENS);
    o.appendRow(GARDIENS_ENTETES);
    o.setFrozenRows(1);
    o.getRange(1, 1, o.getMaxRows(), GARDIENS_ENTETES.length).setNumberFormat('@');
  }
  return o;
}

function lireCalendrierGardiens() {
  const o = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ONGLET_CALENDRIER);
  const lignes = o.getRange(1, 1, o.getLastRow(), 9).getDisplayValues();
  const matchs = [];
  let periode = 0;
  lignes.forEach((r, i) => {
    if (String(r[2]).trim().toLowerCase() === 'time') { periode++; return; }
    const date = String(r[1]).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !String(r[3]).trim()) return;
    matchs.push({
      num: String(r[0]).trim(), date: date, periode: Math.max(1, periode), ligne: i + 1,
      visiteur: CODES_NOMS_COMPLETS[String(r[3]).trim().toLowerCase()] || '',
      domicile: CODES_NOMS_COMPLETS[String(r[8]).trim().toLowerCase()] || '',
    });
  });
  return matchs;
}

function finsDePeriode(matchs) {
  const fins = {};
  matchs.forEach(m => { if (!fins[m.periode] || m.date > fins[m.periode]) fins[m.periode] = m.date; });
  return fins;
}

function aujourdhuiLigue() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Dimanche de la semaine en cours (semaines du lundi au dimanche, comme le calendrier) :
// les matchs de la semaine peuvent être joués et soumis d'avance.
function finSemaineLigue() {
  const [a, m, j] = aujourdhuiLigue().split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()) % 7);
  return d.toISOString().slice(0, 10);
}

function declarerGardien(d, membre) {
  const code = codeDuMembre(membre);
  if (!code) return { ok: false, erreur: 'equipe' };
  const matchs = lireCalendrierGardiens();
  const m = matchs.find(x => x.num === String(d.match || '').trim());
  if (!m || (m.visiteur !== code && m.domicile !== code)) return { ok: false, erreur: 'match' };
  if (finsDePeriode(matchs)[m.periode] < aujourdhuiLigue()) return { ok: false, erreur: 'periode_terminee' };
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const o = ongletGardiens();
    const valeurs = [code, String(m.periode), m.num, m.date, m.visiteur === code ? m.domicile : m.visiteur, new Date().toISOString()];
    const lignes = o.getLastRow() > 1 ? o.getRange(2, 1, o.getLastRow() - 1, 2).getDisplayValues() : [];
    const i = lignes.findIndex(l => l[0] === code && Number(l[1]) === m.periode);
    if (i >= 0) o.getRange(i + 2, 1, 1, valeurs.length).setValues([valeurs]);
    else o.appendRow(valeurs);
    return { ok: true, periode: m.periode, match: m.num };
  } finally {
    verrou.releaseLock();
  }
}

function retirerGardien(d, membre) {
  const code = codeDuMembre(membre);
  if (!code) return { ok: false, erreur: 'equipe' };
  const periode = Number(d.periode);
  if (finsDePeriode(lireCalendrierGardiens())[periode] < aujourdhuiLigue()) return { ok: false, erreur: 'periode_terminee' };
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const o = ongletGardiens();
    if (o.getLastRow() < 2) return { ok: true };
    const lignes = o.getRange(2, 1, o.getLastRow() - 1, 2).getDisplayValues();
    const i = lignes.findIndex(l => l[0] === code && Number(l[1]) === periode);
    if (i >= 0) o.deleteRow(i + 2);
    return { ok: true };
  } finally {
    verrou.releaseLock();
  }
}

// Messages du jour : rappel 3 jours avant la fin d'une période (équipes sans
// déclaration) et, le lendemain de la fin, la liste des équipes illégales.
function rappelsGardiens() {
  const matchs = lireCalendrierGardiens();
  const fins = finsDePeriode(matchs);
  const jour = aujourdhuiLigue();
  const o = ongletGardiens();
  const faites = new Set((o.getLastRow() > 1 ? o.getRange(2, 1, o.getLastRow() - 1, 2).getDisplayValues() : [])
    .map(l => l[0] + '|' + Number(l[1])));
  const codes = Object.keys(CODES_EQUIPES).map(nom => CODES_EQUIPES[nom]);
  const ecart = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  const messages = [];
  Object.keys(fins).forEach(p => {
    const manquantes = codes.filter(c => !faites.has(c + '|' + Number(p))).map(nomEquipe);
    const fin = fins[p];
    if (ecart(jour, fin) === JOURS_RAPPEL && manquantes.length) {
      messages.push(messageGardiens('⏳ Rappel 2e gardien — période ' + p,
        'La période ' + p + ' se termine le **' + fin + '** (dans ' + JOURS_RAPPEL + ' jours).\n'
        + 'Équipes qui n\'ont pas encore déclaré de match pour leur 2e gardien :\n' + manquantes.join(', '), 0xE0A800));
    }
    if (ecart(fin, jour) === 1) {
      messages.push(manquantes.length
        ? messageGardiens('🚨 Fin de la période ' + p + ' — équipes illégales',
          'Aucun départ du 2e gardien déclaré pendant la période ' + p + ' :\n' + manquantes.join(', '), 0xE03131)
        : messageGardiens('✅ Fin de la période ' + p, 'Toutes les équipes ont fait jouer leur 2e gardien.', 0x2F9E44));
    }
  });
  return { ok: true, messages: messages };
}

function messageGardiens(titre, texte, couleur) {
  return {
    flux: 'GARDIENS',
    message: {
      username: '2e gardien · LNHQ',
      avatar_url: 'https://lnhq.ca/logo-lnhq.png',
      embeds: [{ title: titre, url: 'https://lnhq.ca/calendrier.html', description: texte, color: couleur }],
      allowed_mentions: { parse: [] },
    },
  };
}

/* =========================================================================
   RÉSULTATS DES MATCHS (publier.lnhq.ca/resultat.html)
   Un des deux DGs soumet la photo de l'écran de fin de match ; le Worker la fait
   lire par Gemini, le DG vérifie les valeurs, puis ce script enregistre :
     - la photo dans le dossier Drive « LNHQ — Résultats des matchs » ;
     - une ligne par match dans l'onglet public RESULTATS ;
     - le score dans SCHEDULE (F = visiteur, G = domicile).
   Une fois soumis, seul un dirigeant (case « Annonces ») peut corriger un résultat.
   ========================================================================= */
const ONGLET_RESULTATS = 'RESULTATS';
// Même ordre que STATS dans resultats-donnees.js (2 colonnes chacune : visiteur, domicile).
const RESULTATS_STATS = ['tirs', 'mises', 'attaque', 'passes', 'engagements', 'penalites', 'avantages', 'minAvantage', 'inferiorite'];
const RESULTATS_NOMS = ['Tirs', 'Mises en échec', "Temps d'attaque", 'Passes', 'Mises au jeu', 'Min. pénalité', 'Avantages num.', 'Min. avantage', 'Buts inf.'];
const RESULTATS_ENTETES = ['Match', 'Date', 'Visiteur', 'Domicile', 'Buts V', 'Buts D', 'Fin']
  .concat(...RESULTATS_NOMS.map(n => [n + ' V', n + ' D']))
  .concat(['Photo', 'Soumis par', 'Soumis le']);
const FINS_MATCH = ['', 'PROL', 'TB'];

function ongletResultats() {
  const classeur = SpreadsheetApp.openById(SHEET_ID);
  let o = classeur.getSheetByName(ONGLET_RESULTATS);
  if (!o) {
    o = classeur.insertSheet(ONGLET_RESULTATS);
    o.appendRow(RESULTATS_ENTETES);
    o.setFrozenRows(1);
    // Texte forcé : « 02:00 » ou « 80.3% » ne doivent pas devenir une heure ou un nombre.
    o.getRange(1, 1, o.getMaxRows(), RESULTATS_ENTETES.length).setNumberFormat('@');
  }
  return o;
}

/* =========================================================================
   ALIGNEMENTS (publier.lnhq.ca/alignement.html, affiché sur la page Équipe)
   Une ligne par équipe : une colonne par place (4 trios, 3 paires, 2 gardiens),
   avec le nom « Nom, Prénom » de la colonne B de PLAYERSDATABASE. Le DG modifie
   son équipe ; un dirigeant (case « Annonces ») peut modifier toutes les équipes.
   Les places vides sont complétées automatiquement à l'affichage (alignement.js).
   ========================================================================= */
const ONGLET_ALIGNEMENTS = 'ALIGNEMENTS';
const PLACES_ALIGNEMENT = ['A1G', 'A1C', 'A1D', 'A2G', 'A2C', 'A2D', 'A3G', 'A3C', 'A3D', 'A4G', 'A4C', 'A4D',
  'D1G', 'D1D', 'D2G', 'D2D', 'D3G', 'D3D', 'G1', 'G2'];
const ALIGNEMENTS_ENTETES = ['Équipe'].concat(PLACES_ALIGNEMENT, ['Modifié le', 'Par']);

function ongletAlignements() {
  const classeur = SpreadsheetApp.openById(SHEET_ID);
  let o = classeur.getSheetByName(ONGLET_ALIGNEMENTS);
  if (!o) {
    o = classeur.insertSheet(ONGLET_ALIGNEMENTS);
    o.appendRow(ALIGNEMENTS_ENTETES);
    o.setFrozenRows(1);
    o.getRange(1, 1, o.getMaxRows(), ALIGNEMENTS_ENTETES.length).setNumberFormat('@');
  }
  return o;
}

// Joueurs de l'équipe (colonne B), sans les choix de repêchage.
function joueursEquipe(code) {
  const o = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ONGLET_JOUEURS);
  const lignes = o.getRange(2, 1, o.getLastRow() - 1, COL_EQUIPE_JOUEUR).getDisplayValues();
  const noms = new Set();
  lignes.forEach(l => {
    if (String(l[COL_EQUIPE_JOUEUR - 1]).trim().toUpperCase() === code && String(l[7]).trim().toUpperCase() !== 'CHOIX' && String(l[1]).trim()) {
      noms.add(String(l[1]).trim());
    }
  });
  return noms;
}

function sauverAlignement(d, membre) {
  const admin = peutModifier(membre);
  const sienne = codeDuMembre(membre);
  const code = String(d.equipe || sienne || '').trim().toUpperCase();
  if (!code || !Object.keys(CODES_EQUIPES).some(n => CODES_EQUIPES[n] === code)) return { ok: false, erreur: 'equipe' };
  if (!admin && code !== sienne) return { ok: false, erreur: 'pas_ton_equipe' };

  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const o = ongletAlignements();
    const codes = o.getLastRow() > 1 ? o.getRange(2, 1, o.getLastRow() - 1, 1).getDisplayValues().map(l => l[0]) : [];
    const i = codes.indexOf(code);
    // Retour à l'alignement automatique : la ligne de l'équipe est effacée.
    if (d.automatique) {
      if (i >= 0) o.deleteRow(i + 2);
      return { ok: true, automatique: true };
    }
    const roster = joueursEquipe(code);
    const places = d.places || {};
    const vus = new Set();
    const valeurs = [code];
    for (const id of PLACES_ALIGNEMENT) {
      const nom = String(places[id] || '').trim();
      if (nom) {
        if (!roster.has(nom)) return { ok: false, erreur: 'joueur', joueur: nom };
        if (vus.has(nom)) return { ok: false, erreur: 'doublon', joueur: nom };
        vus.add(nom);
      }
      valeurs.push(nom);
    }
    valeurs.push(new Date().toISOString(), sienne || 'Ligue');
    const rang = o.getRange(i >= 0 ? i + 2 : o.getLastRow() + 1, 1, 1, valeurs.length);
    rang.setNumberFormat('@').setValues([valeurs]);
    return { ok: true };
  } finally {
    verrou.releaseLock();
  }
}

/* =========================================================================
   NUMÉROS LNH DES JOUEURS (photos des cartes d'alignement)
   Onglet IDS_LNH : Joueur (« Nom, Prénom » de PLAYERSDATABASE) | NHL ID | Statut | Candidats.
   À lancer à la main (Exécuter → remplirIdsLnh), autant de fois que nécessaire : chaque
   exécution reprend où la précédente s'est arrêtée (limite de temps d'Apps Script) et ne
   touche jamais une ligne qui a déjà un numéro (correction manuelle respectée).
   Recherche : search.d3.nhle.com (nom exact, puis pays de naissance et position pour
   départager les homonymes). Statut : « auto », « à vérifier » (plusieurs candidats,
   listés), « introuvable ». Pour corriger : écrire le bon numéro et le statut « manuel ».
   Photo : https://assets.nhle.com/mugs/nhl/latest/<NHL ID>.png
   ========================================================================= */
const ONGLET_IDS_LNH = 'IDS_LNH';
const IDS_LNH_ENTETES = ['Joueur', 'NHL ID', 'Statut', 'Candidats'];
// Pays : code du classeur (CIO) → code de la LNH (ISO), quand ils diffèrent.
const PAYS_CIO_ISO = { GER: 'DEU', SUI: 'CHE', DEN: 'DNK', LAT: 'LVA', NED: 'NLD', SLO: 'SVN', CRO: 'HRV', RSA: 'ZAF', POR: 'PRT', GRE: 'GRC', BUL: 'BGR', MGL: 'MNG' };

function ongletIdsLnh() {
  const classeur = SpreadsheetApp.openById(SHEET_ID);
  let o = classeur.getSheetByName(ONGLET_IDS_LNH);
  if (!o) {
    o = classeur.insertSheet(ONGLET_IDS_LNH);
    o.appendRow(IDS_LNH_ENTETES);
    o.setFrozenRows(1);
    o.getRange(1, 1, o.getMaxRows(), IDS_LNH_ENTETES.length).setNumberFormat('@');
  }
  return o;
}

function normaliserNom(nom) {
  return String(nom || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function remplirIdsLnh() {
  const debut = Date.now();
  const o = ongletIdsLnh();
  const pdb = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ONGLET_JOUEURS);
  const lignes = pdb.getRange(2, 1, pdb.getLastRow() - 1, 11).getDisplayValues();   // A à K
  // Joueurs à traiter : nom en B, pas un choix de repêchage, pas déjà dans IDS_LNH.
  const deja = new Set((o.getLastRow() > 1 ? o.getRange(2, 1, o.getLastRow() - 1, 1).getDisplayValues() : []).map(l => l[0]));
  const vus = new Set();
  const aFaire = [];
  lignes.forEach(l => {
    const nom = String(l[1]).trim();
    if (!nom || nom === 'JOUEUR' || String(l[7]).trim().toUpperCase() === 'CHOIX' || deja.has(nom) || vus.has(nom)) return;
    vus.add(nom);
    const v = nom.indexOf(',');
    const famille = v > 0 ? nom.slice(0, v).trim() : nom;
    const prenom = v > 0 ? nom.slice(v + 1).trim() : '';
    aFaire.push({ nom: nom, complet: (prenom + ' ' + famille).trim(), famille: famille, prenom: prenom,
      pays: String(l[6]).trim().toUpperCase(), po: String(l[7]).trim().toUpperCase(), ht: String(l[10]).trim() });
  });

  // PO : « C », « LW/RW », « LD »… (ou l'ancien format C/L/R/D) ; la LNH donne C/L/R/D/G.
  const groupe = po => { const p = String(po).split('/')[0]; return p === 'G' ? 'G' : /^(D|LD|RD)$/.test(p) ? 'D' : 'A'; };
  const chercher = textes => UrlFetchApp.fetchAll(textes.map(t => ({
    url: 'https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=40&q=' + encodeURIComponent(normaliserNom(t)),
    muteHttpExceptions: true,
  }))).map(r => { try { return JSON.parse(r.getContentText()) || []; } catch (e) { return []; } });
  // Homonymes : pays de naissance, puis position, puis joueur actif, puis grandeur.
  const departager = (cands, j) => {
    const pays = PAYS_CIO_ISO[j.pays] || j.pays;
    const etapes = [
      r => String(r.birthCountry || '').toUpperCase() === pays,
      r => groupe(String(r.positionCode || '').toUpperCase()) === groupe(j.po),
      r => r.active === true,
      r => normaliserNom(r.height) === normaliserNom(j.ht),
    ];
    for (const f of etapes) {
      if (cands.length <= 1) break;
      const garde = cands.filter(f);
      if (garde.length) cands = garde;
    }
    return cands;
  };
  let traites = 0;
  for (let i = 0; i < aFaire.length; i += 40) {
    if (Date.now() - debut > 4.5 * 60 * 1000) break;   // on s'arrête avant la limite de 6 minutes
    const lot = aFaire.slice(i, i + 40);
    const reponses = chercher(lot.map(j => j.complet));
    const candidats = lot.map((j, k) => departager(reponses[k].filter(r => normaliserNom(r.name) === normaliserNom(j.complet)), j));
    // Prénom différent (surnom : Sam/Samuel, Jake/Jacob) : recherche par nom de famille, avec
    // la même initiale, le même pays de naissance et la même position.
    const sansNom = lot.map((j, k) => k).filter(k => !candidats[k].length);
    if (sansNom.length) {
      const parFamille = chercher(sansNom.map(k => lot[k].famille));
      sansNom.forEach((k, n) => {
        const j = lot[k];
        const pays = PAYS_CIO_ISO[j.pays] || j.pays;
        candidats[k] = departager(parFamille[n].filter(r => {
          const nr = normaliserNom(r.name);
          return nr.endsWith(' ' + normaliserNom(j.famille)) && nr[0] === normaliserNom(j.prenom)[0]
            && String(r.birthCountry || '').toUpperCase() === pays
            && groupe(String(r.positionCode || '').toUpperCase()) === groupe(j.po);
        }), j);
      });
    }
    const nouvelles = lot.map((j, k) => {
      const res = reponses[k];
      let cands = candidats[k];
      if (cands.length > 1) {
        // Encore plusieurs : on garde le plus récent comme proposition, à vérifier.
        cands.sort((a, b) => String(b.lastSeasonId || '').localeCompare(String(a.lastSeasonId || '')));
        return [j.nom, String(cands[0].playerId), 'à vérifier',
          cands.map(r => r.playerId + ' ' + (r.positionCode || '') + ' ' + (r.birthCountry || '') + ' ' + (r.lastTeamAbbrev || '')).join(' | ')];
      }
      if (cands.length === 1) return [j.nom, String(cands[0].playerId), 'auto', ''];
      return [j.nom, '', 'introuvable', res.slice(0, 3).map(r => r.playerId + ' ' + r.name).join(' | ')];
    });
    const rang = o.getRange(o.getLastRow() + 1, 1, nouvelles.length, IDS_LNH_ENTETES.length);
    rang.setNumberFormat('@').setValues(nouvelles);
    traites += nouvelles.length;
  }
  const reste = aFaire.length - traites;
  console.log(traites + ' joueur(s) traité(s). ' + (reste > 0 ? reste + ' restant(s) : relance remplirIdsLnh.' : 'Terminé.'));
}

// Corrections confirmées par la ligue (noms écrits autrement dans la LNH). À lancer à la main :
// écrit le numéro avec le statut « manuel » et retire la ligne d'en-tête lue par erreur.
const CORRECTIONS_IDS_LNH = {
  "O'Reilly, Ryan": '8475158', 'Silayev, Anton': '8484987', 'Surin, Yegor': '8484993',
  'Sokolovsky, Maxim': '8486101', 'Shilov, Yegor': '8486099', 'Mooney, L.J.': '8485598',
  // Homonymes mal associés (vérifiés par date de naissance, 2026-10-03)
  'Brown, Josh': '8477384', 'Murray, Matt': '8476899',
};
// Tir (colonne J) manquant, vérifié dans l'API LNH : écrit seulement si la case est vide.
const TIRS_MANQUANTS = { 'Black, Cooper': 'L', 'Tomkins, Matt': 'L', 'Kahkonen, Kaapo': 'L',
  // Joueurs d'équipe (vérifiés via IDS_LNH)
  'Dipietro, Michael': 'L', 'Dagenais, Maddox': 'L', 'Wyttenbach, Ethan': 'R', 'Boumedienne, Sascha': 'L',
  'George, Carter': 'L', 'Plante, Max': 'L', 'Augustine, Trey': 'L', 'Cover, Jaxon': 'L', 'Command, Alexander': 'L',
  'Poirier, Remi': 'L', 'Levi, Devon': 'L', 'Bleyl, Tommy': 'R', 'Carels, Carson': 'L' };
function appliquerCorrectionsIdsLnh() {
  const o = ongletIdsLnh();
  if (o.getLastRow() < 2) return;
  const lignes = o.getRange(2, 1, o.getLastRow() - 1, 2).getDisplayValues();
  let n = 0;
  lignes.forEach((l, i) => {
    const id = CORRECTIONS_IDS_LNH[l[0]];
    if (id) { o.getRange(i + 2, 2, 1, 3).setNumberFormat('@').setValues([[id, 'manuel', '']]); n++; }
  });
  // Ligne « JOUEUR » (en-tête de PLAYERSDATABASE) : supprimée, du bas vers le haut.
  for (let i = lignes.length - 1; i >= 0; i--) if (lignes[i][0] === 'JOUEUR') o.deleteRow(i + 2);
  console.log(n + ' correction(s) appliquée(s).');

  const pdb = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ONGLET_JOUEURS);
  const joueurs = pdb.getRange(1, COL_JOUEUR, pdb.getLastRow(), 9).getDisplayValues();   // B à J
  let tirs = 0;
  joueurs.forEach((l, i) => {
    const tir = TIRS_MANQUANTS[String(l[0]).trim()];
    if (tir && !String(l[8]).trim()) { pdb.getRange(i + 1, 10).setValue(tir); tirs++; }
  });
  console.log(tirs + ' tir(s) manquant(s) rempli(s).');
}

// Agents libres ajoutés par la ligue (liste du 2026-10-03), noms exacts de la colonne B.
// À lancer à la main : met « UFA » dans la colonne Z (LNHQ TM) de ces joueurs, seulement si
// la case est vide ou déjà UFA (un joueur dans une équipe n'est jamais retiré).
const NOUVEAUX_UFA = [
  'Reaves, Ryan', 'Petry, Jeff', 'van Riemsdyk, James', 'Dadonov, Evgenii', 'Glendening, Luke', 'Smith, Brendan', 'Hamonic, Travis', 'Dowling, Justin', 'Henrique, Adam', 'Palat, Ondrej', 'Belzile, Alex', 'Pitlick, Tyler', 'Bjugstad, Nick', 'Gustafsson, Erik', 'Janmark, Mattias', 'Gravel, Kevin', 'Saad, Brandon', 'Sheary, Conor', 'Pearson, Tanner', 'Gudbranson, Erik', 'Petrovic, Alexander', 'McIlrath, Dylan', 'Hutton, Ben', 'Rooney, Kevin', 'Brodzinski, Jonny', 'Schmelzer, Ryan', 'Brown, Josh', 'Pouliot, Derrick', 'Rosen, Calle', 'Johnston, Ross', 'Girgensons, Zemgus', 'Dumba, Matt', 'Toninato, Dominic', 'O\'Brien, Liam', 'Mermis, Dakota', 'DeSimone, Nick', 'Jankowski, Mark', 'Bayreuther, Gavin', 'Aston-Reese, Zach', 'Lazar, Curtis', 'Burroughs, Kyle', 'Hayden, John', 'Lettieri, Vinni', 'Schueneman, Corey', 'Erne, Adam', 'Lagesson, William', 'Appleton, Mason', 'Joshua, Dakota', 'Hughes, Cameron', 'Blais, Sammy', 'Fabbri, Robby', 'Kirkland, Justin', 'Mangiapane, Andrew', 'Ahcan, Jack', 'Carlsson, Lucas', 'Fitzgerald, Casey', 'Juulsen, Noah', 'Capobianco, Kyle', 'Bear, Ethan', 'Duehr, Walker', 'Condotta, Lucas', 'White, Colin', 'Pederson, Lane', 'Viel, Jeffrey', 'Jones, Caleb', 'Kiersted, Matt', 'Dunne, Joshua', 'Jaaska, Juha', 'Frederic, Trent', 'Huntington, Jimmy', 'Bean, Jake', 'Meyers, Ben', 'Matinpalo, Nikolas', 'Valimaki, Juuso', 'Timmins, Conor', 'Tsyplakov, Maxim', 'Coghlan, Dylan', 'Nylander, Alex', 'Jones, Max', 'Dube, Dillon', 'Cholowski, Dennis', 'Tufte, Riley', 'Gregor, Noah', 'Jost, Tyson', 'Middleton, Keaton', 'Metsa, Zach', 'Ward, Taylor', 'Leonard, John', 'Shaw, Mason', 'Chaffee, Mitchell', 'Jones, Ben', 'MacLean, Kyle', 'Studnicka, Jack', 'Crotty, Cameron', 'Entwistle, Mackenzie', 'Vaakanainen, Urho', 'Harvey-Pinard, Rafael', 'Hamblin, James', 'Rathbone, Jack', 'Crookshank, Angus', 'Steeves, Alex', 'McLaughlin, Marc', 'Regenda, Pavol', 'Del Gaizo, Marc', 'Lee, Andre', 'Stastney, Spencer', 'Solovyov, Ilya', 'Reinhardt, Cole', 'Foote, Nolan', 'Douglas, Curtis', 'Foudy, Liam', 'Thomas, Akil', 'Bolduc, Samuel', 'Gustafsson, David', 'Hallander, Filip', 'Abruzzese, Nicholas', 'Attard, Ronald', 'Halonen, Brian', 'Morton, Sam', 'Callahan, Michael', 'St. Ivany, Jack', 'Leason, Brett', 'Guttman, Cole', 'Formenton, Alex',
];
function marquerNouveauxUfa() {
  const o = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ONGLET_JOUEURS);
  const n = o.getLastRow() - 1;
  const noms = o.getRange(2, COL_JOUEUR, n, 1).getDisplayValues();
  const equipes = o.getRange(2, COL_EQUIPE_JOUEUR, n, 1).getDisplayValues();
  const voulus = new Set(NOUVEAUX_UFA);
  const trouves = new Set();
  const gardes = [];
  let changes = 0;
  noms.forEach((l, i) => {
    const nom = String(l[0]).trim();
    if (!voulus.has(nom)) return;
    trouves.add(nom);
    const actuelle = String(equipes[i][0]).trim().toUpperCase();
    if (actuelle && actuelle !== STATUT_UFA) { gardes.push(nom + ' (' + actuelle + ')'); return; }
    if (actuelle !== STATUT_UFA) { o.getRange(i + 2, COL_EQUIPE_JOUEUR).setValue(STATUT_UFA); changes++; }
  });
  const absents = NOUVEAUX_UFA.filter(x => !trouves.has(x));
  console.log(changes + ' joueur(s) mis UFA. Gardés dans leur équipe : ' + (gardes.join(', ') || 'aucun')
    + '. Introuvables : ' + (absents.join(', ') || 'aucun') + '.');
}

// Ajouts et retraits d'agents libres (à lancer à la main : corrigerUfaListe). Un ajout ne
// touche qu'une case vide ou déjà UFA ; un retrait ne vide qu'une case qui contient « UFA ».
// Dernière liste (2026-10-03) : 24 joueurs de 22 à 24 ans et 25 gardiens.
// (Précédente, déjà appliquée : 23 ajouts dont Hanley, Cizikas… et 3 retraits : C. Hughes, L. Carlsson, D. Coghlan.)
const UFA_A_AJOUTER = ['Thrun, Henry', 'Nesterenko, Nikita', 'Robertson, Matthew', 'Parent, Xavier', 'Pelletier, Jakob',
  'Poulin, Samuel', 'Suzuki, Ryan', 'Kaliyev, Arthur', 'Tomasino, Philip', 'Bains, Arshdeep', 'Hyry, Arttu',
  'Kolyachonok, Vladislav', 'Phillips, Isaak', 'Gaucher, Jacob', 'Heinola, Ville', 'Bjornfot, Tobias', 'Bordeleau, Thomas',
  'Hunt, Daemon', 'Wiesblatt, Ozzy', 'Slaggert, Landon', 'Mazur, Carter', 'Stranges, Antonio', 'Dorwart, Karsen',
  'Ostapchuk, Zack', 'Reimer, James', 'Grubauer, Philipp', 'Pickard, Calvin', 'Houser, Michael', 'Rittich, David',
  'Copley, Pheonix', 'Brossoit, Laurent', 'Murray, Matt', 'Merzlikins, Elvis', 'Tomkins, Matt', 'Jarry, Tristan',
  'Husso, Ville', 'Johansson, Jonas', 'Demko, Thatcher', 'Hill, Adin', 'Kahkonen, Kaapo', 'Halverson, Brandon',
  'Vanecek, Vitek', 'Samsonov, Ilya', 'Primeau, Cayden', 'Tarasov, Daniil', 'Stevenson, Clay', 'Daws, Nico',
  'Tolopilo, Nikita', 'Black, Cooper'];
const UFA_A_RETIRER = [];
function corrigerUfaListe() {
  const o = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ONGLET_JOUEURS);
  const n = o.getLastRow() - 1;
  const noms = o.getRange(2, COL_JOUEUR, n, 1).getDisplayValues();
  const equipes = o.getRange(2, COL_EQUIPE_JOUEUR, n, 1).getDisplayValues();
  const ajouts = new Set(UFA_A_AJOUTER), retraits = new Set(UFA_A_RETIRER);
  let ajoutes = 0, retires = 0;
  const gardes = [], trouves = new Set();
  noms.forEach((l, i) => {
    const nom = String(l[0]).trim();
    const actuelle = String(equipes[i][0]).trim().toUpperCase();
    if (ajouts.has(nom)) {
      trouves.add(nom);
      if (actuelle && actuelle !== STATUT_UFA) gardes.push(nom + ' (' + actuelle + ')');
      else if (actuelle !== STATUT_UFA) { o.getRange(i + 2, COL_EQUIPE_JOUEUR).setValue(STATUT_UFA); ajoutes++; }
    } else if (retraits.has(nom) && actuelle === STATUT_UFA) {
      o.getRange(i + 2, COL_EQUIPE_JOUEUR).setValue(''); retires++;
    }
  });
  console.log(ajoutes + ' ajouté(s) UFA, ' + retires + ' retiré(s). Gardés dans leur équipe : ' + (gardes.join(', ') || 'aucun')
    + '. Introuvables : ' + (UFA_A_AJOUTER.filter(x => !trouves.has(x)).join(', ') || 'aucun') + '.');
}

// Joueurs des listes UFA absents de PLAYERSDATABASE (LAH / Europe) : ajoutés en nouvelles
// lignes, statut UFA. Infos tirées de l'API LNH (api-web.nhle.com) ; OV connu seulement pour
// les 4 de la liste avec OV (les autres restent vides, à remplir à la main).
// [prénom, nom, OV, naissance, pays, PO, PO2, SH, HT, WT, YRS, salaire 2026-27]
// À lancer à la main : ajouterJoueursUfa (relançable : un nom déjà présent en B est ignoré).
const NOUVEAUX_JOUEURS_UFA = [
  ['Logan', 'Shaw', '', '1992-10-05', 'CAN', 'R', 'A', 'R', '6\'3"', 208, '', ''],
  ['Seth', 'Griffith', '', '1993-01-04', 'CAN', 'C', 'A', 'R', '5\'9"', 190, '', ''],
  ['Brett', 'Seney', '', '1996-02-28', 'CAN', 'L', 'A', 'L', '5\'9"', 156, '', ''],
  ['Austin', 'Watson', '', '1992-01-13', 'USA', 'R', 'A', 'R', '6\'4"', 203, '', ''],
  ['Gustav', 'Olofsson', '', '1994-12-01', 'SWE', 'D', 'D', 'L', '6\'2"', 199, '', ''],
  ['Austin', 'Poganski', '', '1996-02-16', 'USA', 'R', 'A', 'R', '6\'1"', 206, '', ''],
  ['Roland', 'McKeown', '', '1996-01-20', 'CAN', 'D', 'D', 'R', '6\'1"', 195, '', ''],
  ['Tobie', 'Paquette-Bisson', '', '1997-02-01', 'CAN', 'D', 'D', 'L', '6\'3"', 207, '', ''],
  ['Travis', 'Dermott', '', '1996-12-22', 'CAN', 'D', 'D', 'L', '6\'0"', 200, '', ''],
  ['Brian', 'Pinho', '', '1995-05-11', 'USA', 'C', 'A', 'R', '6\'2"', 188, '', ''],
  ['Travis', 'Boyd', '', '1993-09-14', 'USA', 'C', 'A', 'R', '6\'0"', 190, '', ''],
  ['Michael', 'Sgarbossa', '', '1992-07-25', 'CAN', 'C', 'A', 'L', '6\'0"', 179, '', ''],
  ['Matthew', 'Peca', '', '1993-04-27', 'CAN', 'L', 'A', 'L', '5\'10"', 181, '', ''],
  ['T.J.', 'Tynan', '', '1992-02-25', 'USA', 'C', 'A', 'R', '5\'8"', 160, '', ''],
  ['Jani', 'Hakanpaa', '', '1992-03-31', 'FIN', 'D', 'D', 'R', '6\'7"', 225, '', ''],
  ['Connor', 'Carrick', '', '1994-04-13', 'USA', 'D', 'D', 'R', '5\'10"', 198, '', ''],
  ['Hudson', 'Fasching', '', '1995-07-28', 'USA', 'C', 'A', 'R', '6\'3"', 214, '', ''],
  ['Justin', 'Bailey', '', '1995-07-01', 'USA', 'R', 'A', 'R', '6\'4"', 214, '', ''],
  ['David', 'Quenneville', '', '1998-03-13', 'CAN', 'D', 'D', 'R', '5\'8"', 189, '', ''],
  ['Brett', 'Ritchie', '', '1993-07-01', 'CAN', 'R', 'A', 'R', '6\'4"', 215, '', ''],
  ['Pierrick', 'Dube', 71, '2001-01-07', 'FRA', 'R', 'A', 'R', '5\'9"', 172, 1, 850000],
  ['Collin', 'Delia', 76, '1994-06-20', 'USA', 'G', 'G', 'L', '6\'2"', 208, 1, 850000],
  ['Kevin', 'Mandolese', 74, '2000-08-22', 'CAN', 'G', 'G', 'L', '6\'4"', 180, 1, 850000],
  ['Vadim', 'Zherenko', 73, '2001-03-15', 'RUS', 'G', 'G', 'L', '6\'4"', 210, 1, 850000],
  ['Oliver', 'Wahlstrom', '', '2000-06-13', 'USA', 'R', 'A', 'R', '6\'2"', 205, '', ''],
  // 2e envoi : absents de la base (OV et mise minimale de la liste complète)
  ['Ryan', 'Suter', 80, '1985-01-21', 'USA', 'D', 'D', 'L', '6\'1"', 201, 1, 850000],
  ['Marc-Edouard', 'Vlasic', 78, '1987-03-30', 'CAN', 'D', 'D', 'L', '6\'1"', 205, 1, 850000],
  ['Jon', 'Merrill', 77, '1992-02-03', 'USA', 'D', 'D', 'L', '6\'3"', 204, 1, 850000],
  ['Matt', 'Benning', 78, '1994-05-25', 'CAN', 'D', 'D', 'R', '6\'1"', 220, 1, 850000],
  ['Matthew', 'Phillips', 76, '1998-04-06', 'CAN', 'C', 'A', 'R', '5\'8"', 160, 1, 850000],
];
const LIGNE_MODELE_UFA = 'Demko, Thatcher';   // ligne complète servant de modèle (formules, formats)
function ajouterJoueursUfa() {
  const o = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ONGLET_JOUEURS);
  const largeur = 28;   // A à AB
  const noms = o.getRange(1, COL_JOUEUR, o.getLastRow(), 1).getDisplayValues().map(l => String(l[0]).trim());
  const iModele = noms.indexOf(LIGNE_MODELE_UFA);
  if (iModele < 0) throw new Error('Ligne modèle introuvable : ' + LIGNE_MODELE_UFA);
  const modele = o.getRange(iModele + 1, 1, 1, largeur);
  const formules = modele.getFormulasR1C1()[0];
  const existants = new Set(noms);
  const nouveaux = NOUVEAUX_JOUEURS_UFA.filter(j => !existants.has(j[1] + ', ' + j[0]));
  if (!nouveaux.length) { console.log('Rien à ajouter : tous déjà présents.'); return; }

  // Dernière ligne réellement remplie en B (getLastRow peut compter des lignes vides formatées).
  let derniere = noms.length;
  while (derniere > 1 && !noms[derniere - 1]) derniere--;
  const debut = derniere + 1;
  const manque = debut + nouveaux.length - 1 - o.getMaxRows();
  if (manque > 0) o.insertRowsAfter(o.getMaxRows(), manque);

  const lignes = nouveaux.map(([prenom, nom, ov, naissance, pays, po, po2, sh, ht, wt, ans, salaire]) => {
    const l = new Array(largeur).fill('');
    const [a, m, j] = naissance.split('-').map(Number);
    l[0] = prenom + ' ' + nom;        // A
    l[1] = nom + ', ' + prenom;       // B
    l[2] = ov;                        // C  OV
    l[4] = new Date(a, m - 1, j);     // E  naissance
    l[3] = Math.round((Date.now() - l[4]) / (365.25 * 864e5) * 100) / 100;   // D  âge (si pas de formule)
    l[6] = pays;                      // G  CNT
    l[7] = po; l[8] = po2; l[9] = sh; // H, I, J
    l[10] = ht; l[11] = wt;           // K, L
    l[12] = ans; l[13] = salaire;     // M, N
    l[COL_EQUIPE_JOUEUR - 1] = STATUT_UFA;   // Z
    // Colonne calculée dans la ligne modèle (âge, nom, rang…) : posée en formule plus bas.
    return l.map((v, c) => formules[c] ? '' : v);
  });
  const cible = o.getRange(debut, 1, lignes.length, largeur);
  modele.copyTo(cible, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  cible.setValues(lignes);
  const colonnesFormule = [];
  formules.forEach((f, c) => {
    if (!f) return;
    o.getRange(debut, c + 1, lignes.length, 1).setFormulasR1C1(lignes.map(() => [f]));
    colonnesFormule.push((c >= 26 ? 'A' : '') + String.fromCharCode(65 + c % 26));
  });
  console.log(nouveaux.length + ' joueur(s) ajouté(s) UFA, lignes ' + debut + ' à ' + (debut + nouveaux.length - 1)
    + '. Colonnes copiées en formule : ' + (colonnesFormule.join(', ') || 'aucune')
    + (debut + nouveaux.length - 1 > 2686 ? ' ATTENTION : au-delà de la ligne 2686 (plage des formules CHOIX).' : ''));
}

// Annule le changement d'OV fait par erreur le 2026-10-03 (liste complète non fiable) :
// remet l'OV d'avant, seulement si la case contient encore la valeur posée par erreur.
// Les mises minimales posées dans les salaires vides et les joueurs créés sont gardés.
// À lancer à la main : restaurerOvUfa. « Nom, Prénom » : [OV posé par erreur, OV d'avant]
const OV_A_RESTAURER = {
  'Primeau, Cayden': [70, 79], 'Black, Cooper': [70, 75], 'Brodzinski, Jonny': [76, 81], 'Valimaki, Juuso': [80, 75],
  'Jankowski, Mark': [75, 80], 'Steeves, Alex': [75, 79], 'Halverson, Brandon': [74, 78], 'Dube, Dillon': [79, 75],
  'Malott, Jeff': [74, 78], 'Hanley, Joel': [76, 80], 'Robertson, Matthew': [74, 78], 'DeSimone, Nick': [75, 79],
  'Matinpalo, Nikolas': [75, 79], 'Parent, Xavier': [78, 74], 'Belzile, Alex': [76, 73], 'Formenton, Alex': [78, 75],
  'Petrovic, Alexander': [75, 78], 'Mangiapane, Andrew': [82, 79], 'Halonen, Brian': [75, 78],
  'Rosen, Calle': [75, 78], 'Cizikas, Casey': [78, 81], 'Timmins, Conor': [77, 80], 'Carlile, Declan': [75, 78],
  'Dadonov, Evgenii': [76, 79], 'Harkins, Jansen': [75, 78], 'Brown, Josh': [77, 74], 'Dunne, Joshua': [75, 78],
  'Capobianco, Kyle': [75, 78], 'MacLean, Kyle': [76, 79], 'O\'Brien, Liam': [76, 79], 'Glendening, Luke': [77, 80],
  'Gatcomb, Marc': [74, 77], 'Janmark, Mattias': [77, 80], 'Tolopilo, Nikita': [74, 77], 'Sillinger, Owen': [75, 72],
  'Wiesblatt, Ozzy': [74, 77], 'Harvey-Pinard, Rafael': [78, 75], 'Bolduc, Samuel': [78, 75],
  'Laczynski, Tanner': [75, 78], 'Jost, Tyson': [76, 79], 'Vaakanainen, Urho': [77, 80], 'Erne, Adam': [75, 77],
  'Thomas, Akil': [75, 73], 'Nylander, Alex': [77, 75], 'Kaliyev, Arthur': [78, 76], 'Goodrow, Barclay': [78, 80],
  'Jones, Ben': [77, 75], 'Meyers, Ben': [76, 78], 'Saad, Brandon': [81, 79], 'Smith, Brendan': [75, 77],
  'Fitzgerald, Casey': [74, 76], 'White, Colin': [76, 74], 'Douglas, Curtis': [75, 77], 'Lazar, Curtis': [77, 79],
  'Joshua, Dakota': [79, 81], 'Cholowski, Dennis': [75, 77], 'Bear, Ethan': [78, 76], 'Thrun, Henry': [78, 76],
  'Solovyov, Ilya': [76, 78], 'van Riemsdyk, James': [78, 80], 'Petry, Jeff': [78, 80], 'Jaaska, Juha': [75, 73],
  'Middleton, Keaton': [76, 74], 'Condotta, Lucas': [75, 73], 'Entwistle, Mackenzie': [76, 74],
  'Appleton, Mason': [78, 80], 'Tomkins, Matt': [74, 76], 'Bjugstad, Nick': [79, 81], 'Cousins, Nick': [77, 79],
  'Juulsen, Noah': [76, 78], 'Attard, Ronald': [76, 74], 'Stastney, Spencer': [77, 79], 'Pearson, Tanner': [77, 79],
  'Ward, Taylor': [75, 77], 'Frederic, Trent': [81, 79], 'Zherenko, Vadim': [75, 73], 'Lettieri, Vinni': [76, 74],
  'Regula, Alec': [75, 76], 'Englund, Andreas': [76, 75], 'Crookshank, Angus': [76, 75],
  'Stranges, Antonio': [76, 75], 'Bains, Arshdeep': [76, 75], 'Hutton, Ben': [77, 78], 'Leason, Brett': [76, 77],
  'Jones, Caleb': [76, 77], 'Crotty, Cameron': [75, 76], 'Hughes, Cameron': [74, 75], 'Reinhardt, Cole': [74, 75],
  'Delia, Collin': [75, 76], 'Sheary, Conor': [78, 77], 'Schueneman, Corey': [75, 76], 'Pouliot, Derrick': [75, 74],
  'Toninato, Dominic': [75, 76], 'Shine, Dominik': [75, 76], 'Coghlan, Dylan': [76, 75],
  'Gustafsson, Erik': [80, 79], 'Hallander, Filip': [76, 77], 'Ahcan, Jack': [74, 75], 'Rathbone, Jack': [75, 76],
  'St. Ivany, Jack': [76, 75], 'Studnicka, Jack': [75, 74], 'MacDonald, Jacob': [76, 75], 'Bean, Jake': [79, 80],
  'Viel, Jeffrey': [75, 76], 'Schuldt, Jimmy': [74, 75], 'Hicketts, Joe': [75, 76], 'Leonard, John': [75, 76],
  'Kirkland, Justin': [75, 74], 'Rooney, Kevin': [76, 75], 'Pederson, Lane': [75, 74], 'Del Gaizo, Marc': [76, 75],
  'McLaughlin, Marc': [75, 76], 'Dumba, Matt': [80, 79], 'Kiersted, Matt': [75, 74], 'Callahan, Michael': [75, 74],
  'Chaffee, Mitchell': [76, 77], 'Abruzzese, Nicholas': [75, 76], 'Daws, Nico': [76, 75], 'Gregor, Noah': [77, 78],
  'Palat, Ondrej': [79, 80], 'Regenda, Pavol': [76, 77], 'Tufte, Riley': [75, 76], 'Johnston, Ross': [76, 77],
  'Johnson, Ryan': [75, 76], 'Reaves, Ryan': [76, 75], 'Schmelzer, Ryan': [75, 74], 'Morton, Sam': [74, 75],
  'Blais, Sammy': [76, 75], 'Hamonic, Travis': [76, 77], 'Pitlick, Tyler': [75, 74], 'Heinola, Ville': [76, 75],
  'Kolyachonok, Vladislav': [75, 76], 'Duehr, Walker': [75, 74], 'Aston-Reese, Zach': [76, 75],
  'Metsa, Zach': [74, 75], 'Girgensons, Zemgus': [78, 79],
};
function restaurerOvUfa() {
  const o = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ONGLET_JOUEURS);
  const valeurs = o.getRange(1, 1, o.getLastRow(), COL_EQUIPE_JOUEUR).getValues();
  const trouves = new Set(), modifies = [];
  let remis = 0;
  valeurs.forEach((l, i) => {
    const nom = String(l[COL_JOUEUR - 1]).trim();
    const info = OV_A_RESTAURER[nom];
    if (!info || i < 1 || String(l[COL_EQUIPE_JOUEUR - 1]).trim().toUpperCase() !== STATUT_UFA) return;
    trouves.add(nom);
    if (l[2] === info[0]) { o.getRange(i + 1, 3).setValue(info[1]); remis++; }
    else if (l[2] !== info[1]) modifies.push(nom + ' (' + l[2] + ')');
  });
  console.log(remis + ' OV remis comme avant. Modifiés à la main depuis, non touchés : ' + (modifies.join(', ') || 'aucun')
    + '. Introuvables : ' + (Object.keys(OV_A_RESTAURER).filter(x => !trouves.has(x)).join(', ') || 'aucun') + '.');
}

/* =========================================================================
   POSITIONS (2026-10-03) : colonne H au format du jeu, C / LW / RW / LD / RD / G,
   plusieurs positions séparées par « / », la principale d'abord (« C/RW », « LD/RD »).
   Position principale : site EA NHL 27 (top 300), listes UFA du jeu, sinon API LNH via
   IDS_LNH (L → LW, R → RW, D → LD/RD selon le tir). Positions secondaires : listes UFA et
   EliteProspects (les « W » sans côté sont ignorés).
   1. adapterFormulesPositions : les onglets d'équipe trient attaquants / défenseurs avec
      la 1re position (accepte l'ancien et le nouveau format). Relançable.
   2. appliquerPositions : écrit H, seulement si la case contient encore l'ancienne valeur.
   ========================================================================= */
const H_PDB = 'PLAYERSDATABASE!$H$3:$H$2779';
const REMPLACEMENTS_POSITIONS = [
  ['(' + H_PDB + '="C")+(' + H_PDB + '="L")+(' + H_PDB + '="R")', 'REGEXMATCH(' + H_PDB + '&"", "^(C|L|R|LW|RW)(/|$)")'],
  [H_PDB + '="D"', 'REGEXMATCH(' + H_PDB + '&"", "^(D|LD|RD)(/|$)")'],
];
function adapterFormulesPositions() {
  let n = 0;
  SpreadsheetApp.openById(SHEET_ID).getSheets().forEach(o => {
    const lignes = o.getLastRow(), cols = o.getLastColumn();
    if (!lignes || !cols) return;
    const formules = o.getRange(1, 1, lignes, cols).getFormulas();
    formules.forEach((ligne, i) => ligne.forEach((f, j) => {
      if (!f || f.indexOf(H_PDB) < 0) return;
      let g = f;
      REMPLACEMENTS_POSITIONS.forEach(([avant, apres]) => { g = g.split(avant).join(apres); });
      if (g !== f) { o.getRange(i + 1, j + 1).setFormula(g); n++; }
    }));
  });
  console.log(n + ' formule(s) adaptée(s).');
}

// « Nom, Prénom » : [ancienne valeur, nouvelle valeur]
const POSITIONS_NOUVELLES = {
  'Rantanen, Mikko': ['R', 'RW/C'], 'Zibanejad, Mika': ['C', 'C/RW'], 'Hischier, Nico': ['C', 'C/LW'],
  'Mantha, Anthony': ['R', 'RW/LW'], 'Bjorkstrand, Oliver': ['R', 'RW'], 'Brown, Connor': ['R', 'RW/LW'],
  'Kolesar, Keegan': ['R', 'RW'], 'Eller, Lars': ['C', 'C/LW'], 'Carrick, Sam': ['C', 'C/RW'],
  'Rosén, Isak': ['R', 'RW/C'], 'Marjala, Viljami': ['L', 'LW/C'], 'Robidas, Justin': ['C', 'C/RW'],
  'Slavin, Jaccob': ['D', 'LD'], 'Hamilton, Dougie': ['D', 'RD'], 'McCabe, Jake': ['D', 'LD'],
  'Tanev, Christopher': ['D', 'RD'], 'Chatfield, Jalen': ['D', 'RD'], 'Peeke, Andrew': ['D', 'RD'],
  'Mancini, Victor': ['D', 'RD'], 'Crozier, Maxwell': ['D', 'RD'], 'Caufield, Cole': ['R', 'RW/LW'],
  'Svechnikov, Andrei': ['L', 'RW/LW'], 'Bertuzzi, Tyler': ['L', 'LW/RW'],
  'Marchessault, Jonathan': ['C', 'C/LW/RW'], 'Mittelstadt, Casey': ['C', 'C/LW'], 'Hayton, Barrett': ['C', 'C/LW'],
  'Chernyshov, Igor': ['L', 'LW'], 'Sundqvist, Oskar': ['C', 'C/RW'], 'Strome, Ryan': ['C', 'C/RW'],
  'Kuraly, Sean': ['C', 'C/LW'], 'Catton, Berkly': ['C', 'C/LW'], 'Rasmussen, Michael': ['C', 'C/LW'],
  'Hämeenaho, Lenni': ['R', 'RW'], 'Hutson, Lane': ['D', 'LD'], 'Lohrei, Mason': ['D', 'LD'],
  'Orlov, Dmitry': ['D', 'LD'], 'Buium, Zeev': ['D', 'LD'], 'Klingberg, John': ['D', 'RD'],
  'Jensen, Nick': ['D', 'RD'], 'Cagnoni, Luca': ['D', 'LD'], 'Belchetz, Ethan': ['L', 'LW'],
  'Verhoeff, Keaton': ['D', 'RD'], 'Reid, Chase': ['D', 'RD'], 'Kaprizov, Kirill': ['L', 'LW'],
  'Keller, Clayton': ['R', 'RW/LW'], 'Nichushkin, Valeri': ['R', 'RW/LW'], 'Garland, Conor': ['R', 'RW/LW'],
  'Zucker, Jason': ['L', 'LW/RW'], 'Joseph, Mathieu': ['R', 'RW/LW'], 'Beecher, John': ['C', 'C/LW'],
  'Pastujov, Sasha': ['R', 'RW/LW'], 'Nyman, Jani': ['R', 'RW'], 'Ryabkin, Ivan': ['C', 'C/LW'],
  'Hanifin, Noah': ['D', 'LD'], 'Carlson, John': ['D', 'RD'], 'Burns, Brent': ['D', 'RD'],
  'Perbix, Nicklaus': ['D', 'RD'], 'Wotherspoon, Parker': ['D', 'LD'], 'Balinskis, Uvis': ['D', 'LD'],
  'Kuznetsov, Yan': ['D', 'LD'], 'Christiansen, Jake': ['D', 'LD'], 'Reinhart, Sam': ['C', 'RW/C'],
  'Knies, Matthew': ['L', 'LW/RW'], 'Vilardi, Gabriel': ['C', 'C/RW'], 'Norris, Josh': ['C', 'C/LW'],
  'Zetterlund, Fabian': ['L', 'LW/RW'], 'Brink, Bobby': ['R', 'RW'], 'Cowan, Easton': ['C', 'RW/C'],
  'Smith, Cole': ['R', 'RW/LW'], 'Dewar, Connor': ['C', 'C/LW'], 'Honzek, Samuel': ['L', 'LW/C'],
  'Nadeau, Bradly': ['L', 'LW/RW'], 'Helenius, Konsta': ['C', 'C/RW'], 'Hughes, Quinn': ['D', 'LD'],
  'Cihar, Vojtech': ['L', 'LW'], 'Hronek, Filip': ['D', 'RD'], 'Middleton, Jacob': ['D', 'LD'],
  'Siegenthaler, Jonas': ['D', 'LD'], 'Pionk, Neal': ['D', 'RD'], 'Wilsby, Adam': ['D', 'LD'],
  'Boqvist, Adam': ['D', 'RD'], 'Reinbacher, David': ['D', 'RD'], 'Celebrini, Macklin': ['C', 'C/LW'],
  'Ehlers, Nikolaj': ['L', 'LW/RW'], 'Kempe, Adrian': ['R', 'RW/C'], 'Robertson, Nicholas': ['L', 'LW'],
  'Vatrano, Frank': ['R', 'RW/LW'], 'Stenberg, Ivar': ['L', 'LW/RW'], 'Östlund, Noah': ['C', 'C/LW'],
  'Geekie, Conor': ['C', 'C/RW'], 'Koivunen, Ville': ['R', 'RW/C'], 'Brandsegg-Nygård, Michael': ['R', 'RW/LW'],
  'Raddysh, Darren': ['D', 'RD'], 'Dunn, Vince': ['D', 'LD'], 'Rielly, Morgan': ['D', 'LD'],
  'Fowler, Cam': ['D', 'LD'], 'Borgen, William': ['D', 'RD'], 'Reilly, Mike': ['D', 'LD'],
  'Livanavage, Jake': ['D', 'LD'], 'Zharovsky, Alexander': ['R', 'RW/C'], 'Surin, Yegor': ['C', 'C/LW'],
  'Nylander, William': ['R', 'RW/C'], 'Eklund, William': ['L', 'LW/C'], 'Nazar, Frank': ['C', 'C/RW'],
  'Cuylle, Will': ['L', 'LW/RW'], 'Tolvanen, Eeli': ['R', 'RW/LW'], 'Drury, Jack': ['C', 'C/LW'],
  'Bolduc, Zack': ['R', 'RW'], 'Crouse, Lawson': ['L', 'LW/RW'], 'Glass, Cody': ['C', 'C/RW'],
  'Carrier, William': ['L', 'LW/RW'], 'Walker, Nathan': ['L', 'LW/RW'], 'Schwindt, Cole': ['C', 'RW/C'],
  'Lekkerimaki, Jonathan': ['R', 'RW/LW'], 'Kemell, Joakim': ['R', 'RW'], 'Sýkora, Adam': ['L', 'LW/C'],
  'Sanderson, Jake': ['D', 'LD'], 'Weegar, MacKenzie': ['D', 'LD'], 'Moser, J.J.': ['D', 'LD'],
  'McNabb, Brayden': ['D', 'LD'], 'Kesselring, Michael': ['D', 'RD'], 'Stecher, Troy': ['D', 'RD'],
  'Joseph, Pierre-Olivier': ['D', 'LD'], 'Brzustewicz, Hunter': ['D', 'RD'], 'Bedard, Connor': ['C', 'C/LW'],
  'Michkov, Matvei': ['R', 'RW'], 'Slafkovský, Juraj': ['L', 'LW/RW'], 'Landeskog, Gabriel': ['L', 'LW/RW'],
  'Staal, Jordan': ['C', 'C/LW'], 'Foligno, Marcus': ['L', 'LW/RW'], 'Lowry, Adam': ['C', 'C/LW'],
  'Perry, Corey': ['R', 'RW/LW'], 'Foligno, Nick': ['L', 'LW/RW'], 'Armia, Joel': ['R', 'RW/LW'],
  'Zonnon, Bill': ['C', 'RW/C'], 'McAvoy, Charlie': ['D', 'RD'], 'Guhle, Kaiden': ['D', 'LD'],
  'Murphy, Connor': ['D', 'RD'], 'Vlasic, Alex': ['D', 'LD'], 'Carrier, Alexandre': ['D', 'RD'],
  'Holl, Justin': ['D', 'RD'], 'Harris, Jordan': ['D', 'LD'], 'Xhekaj, Florian': ['L', 'LW/C'],
  'Stützle, Tim': ['C', 'C/LW'], 'Guenther, Dylan': ['R', 'LW/RW'], 'Kyrou, Jordan': ['R', 'RW'],
  'Carcone, Michael': ['L', 'LW/C'], 'Poehling, Ryan': ['C', 'C/LW'], 'Perron, David': ['L', 'LW/RW'],
  'Howden, Brett': ['C', 'C/LW'], 'Anderson, Josh': ['R', 'RW/LW'], 'Tanev, Brandon': ['L', 'LW/RW'],
  'Laughton, Scott': ['C', 'C/LW'], 'Engvall, Pierre': ['L', 'LW/RW'], 'Hagens, James': ['C', 'C/LW'],
  'Vilmanis, Sandis': ['L', 'LW/RW'], 'Yager, Brayden': ['C', 'C/RW'], 'Musty, Quentin': ['L', 'LW'],
  'Hughes, Luke': ['D', 'LD'], 'Sandin, Rasmus': ['D', 'LD'], 'Zellweger, Olen': ['D', 'LD'],
  'Durzi, Sean': ['D', 'RD'], 'Ristolainen, Rasmus': ['D', 'RD'], 'Lindstein, Theo': ['D', 'LD'],
  'Engström, Adam': ['D', 'LD'], 'Killorn, Alex': ['L', 'LW/RW'], 'Cooley, Logan': ['C', 'C/LW'],
  'Konecny, Travis': ['R', 'RW/LW'], 'Stankoven, Logan': ['C', 'C/RW'], 'Chinakhov, Egor': ['R', 'RW/LW'],
  'McMann, Bobby': ['C', 'C/LW'], 'Wood, Miles': ['L', 'LW/RW'], 'Boqvist, Jesper': ['C', 'C/LW'],
  'Greene, Ryan': ['C', 'C/RW'], 'Danforth, Justin': ['R', 'RW/C'], 'MacEwen, Zack': ['C', 'RW/C'],
  'Koepke, Cole': ['L', 'LW/RW'], 'Forsling, Gustav': ['D', 'LD'], 'Walman, Jake': ['D', 'LD'],
  'Walker, Sean': ['D', 'RD'], 'Spurgeon, Jared': ['D', 'RD'], 'Maatta, Olli': ['D', 'LD'],
  'Liljegren, Timothy': ['D', 'RD'], 'Kessel, Matthew': ['D', 'RD'], 'Ruck, Liam': ['C', 'RW'],
  'Batherson, Drake': ['R', 'RW/C'], 'Backlund, Mikael': ['C', 'C/LW'], 'Cates, Noah': ['L', 'LW/C'],
  'Toffoli, Tyler': ['C', 'RW/C'], 'Kakko, Kaapo': ['R', 'RW/C'], 'Monahan, Sean': ['C', 'C/LW'],
  'Gaudette, Adam': ['R', 'RW/C'], 'Panarin, Artemi': ['L', 'LW'], 'Holmberg, Pontus': ['R', 'RW/C'],
  'Grundstrom, Carl': ['R', 'RW/LW'], 'Cristall, Andrew': ['L', 'LW'], 'Reichel, Lukas': ['L', 'LW/C'],
  'Faber, Brock': ['D', 'RD'], 'Pesce, Brett': ['D', 'RD'], 'Skjei, Brady': ['D', 'LD'],
  'Duclair, Anthony': ['L', 'LW/C'], 'Bryson, Jacob': ['D', 'LD'], 'Bogosian, Zach': ['D', 'RD'],
  'Myers, Philippe': ['D', 'RD'], 'Villeneuve, Xavier': ['D', 'LD'], 'Pettersson, Marcus': ['D', 'LD'],
  'Bratt, Jesper': ['L', 'LW/RW'], 'Fiala, Kevin': ['L', 'LW/C'], 'Aspirot, Jonathan': ['D', 'LD'],
  'Eberle, Jordan': ['R', 'RW/C'], 'Evans, Jake': ['C', 'C/RW'], 'Reschny, Cole': ['C', 'C/LW'],
  'Schwartz, Jaden': ['C', 'LW'], 'Dach, Kirby': ['C', 'C/RW'], 'Wood, Matthew': ['R', 'RW/LW/C'],
  'Sturm, Nico': ['C', 'C/LW'], 'Hinostroza, Vinnie': ['C', 'C/RW/LW'], 'Novotný, Adam': ['L', 'LW/RW'],
  'O\'Reilly, Sam': ['C', 'RW/C'], 'Coleman, Blake': ['L', 'C/LW/RW'], 'LaCombe, Jackson': ['D', 'LD'],
  'Toews, Devon': ['D', 'LD'], 'D\'Astous, Charle-Edouard': ['D', 'LD'], 'Lundkvist, Nils': ['D', 'RD'],
  'Jones, Seth': ['D', 'RD'], 'Graves, Ryan': ['D', 'LD'], 'Bonk, Oliver': ['D', 'RD'],
  'Wyttenbach, Ethan': ['L', 'LW/RW'], 'Matthews, Auston': ['C', 'C/LW'], 'Tkachuk, Matthew': ['L', 'LW/RW'],
  'Zuccarello, Mats': ['C', 'RW/LW'], 'Laferriere, Alex': ['R', 'RW/LW'], 'Laine, Patrik': ['L', 'LW/RW'],
  'Martinook, Jordan': ['L', 'LW/C'], 'Iafallo, Alex': ['L', 'LW/C'], 'Farabee, Joel': ['L', 'LW/RW'],
  'Drouin, Jonathan': ['L', 'LW/C'], 'Kartye, Tye': ['L', 'LW/C'], 'Carbonneau, Justin': ['R', 'RW'],
  'Lavoie, Raphael': ['C', 'C/RW'], 'Theodore, Shea': ['D', 'LD'], 'Hague, Nicolas': ['D', 'LD'],
  'Ekblad, Aaron': ['D', 'RD'], 'Zub, Artem': ['D', 'RD'], 'Xhekaj, Arber': ['D', 'LD'],
  'Jiříček, Adam': ['D', 'RD'], 'Mukhamadullin, Shakir': ['D', 'LD'], 'Mahura, Josh': ['D', 'LD'],
  'Lindstrom, Cayden': ['C', 'C/LW'], 'Marner, Mitch': ['R', 'RW'], 'Ovechkin, Alex': ['L', 'LW'],
  'Fantilli, Adam': ['C', 'C/LW'], 'Danault, Phillip': ['C', 'C/LW'], 'Roy, Nicolas': ['C', 'C/RW'],
  'Haula, Erik': ['L', 'LW/C'], 'Perreault, Gabe': ['R', 'RW'], 'Frondell, Anton': ['C', 'C/LW'],
  'Gallagher, Brendan': ['R', 'RW'], 'Poitras, Matthew': ['C', 'C/RW'], 'Grebenkin, Nikita': ['R', 'RW'],
  'Gridin, Matvei': ['R', 'RW/LW'], 'Cootes, Braeden': ['C', 'C/RW'], 'Klepov, Nikita': ['R', 'RW/LW'],
  'Morrissey, Josh': ['D', 'LD'], 'Letang, Kris': ['D', 'RD'], 'Helleson, Drew': ['D', 'RD'],
  'Mintyukov, Pavel': ['D', 'LD'], 'Levshunov, Artyom': ['D', 'RD'], 'Bichsel, Lian': ['D', 'LD'],
  'Ufko, Ryan': ['D', 'RD'], 'Brunicke, Harrison': ['D', 'RD'], 'Boldy, Matt': ['L', 'LW/RW'],
  'Terry, Troy': ['R', 'RW/C'], 'McTavish, Mason': ['C', 'C/LW'], 'Marchment, Mason': ['L', 'LW/C'],
  'Newhook, Alex': ['C', 'C/LW'], 'Kuzmenko, Andrei': ['L', 'LW'], 'Heinen, Danton': ['L', 'LW/C'],
  'Back, Oskar': ['C', 'C/LW'], 'Bourgault, Xavier': ['R', 'RW/C'], 'Clarke, Brandt': ['D', 'RD'],
  'Kovacevic, Johnathan': ['D', 'RD'], 'Carlo, Brandon': ['D', 'RD'], 'Bahl, Kevin': ['D', 'LD'],
  'Kulak, Brett': ['D', 'LD'], 'Mayfield, Scott': ['D', 'RD'], 'Benoit, Simon': ['D', 'LD'],
  'Fleury, Haydn': ['D', 'LD'], 'Mooney, L.J.': ['R', 'C/RW'], 'Reid, Cameron': ['D', 'LD'],
  'Stone, Mark': ['R', 'RW'], 'Sennecke, Beckett': ['R', 'LW/RW'], 'Evangelista, Luke': ['R', 'RW'],
  'Hertl, Tomas': ['C', 'C/LW'], 'Bourque, Mavrik': ['C', 'C/RW'], 'Khusnutdinov, Marat': ['C', 'C/LW'],
  'Shabanov, Maxim': ['R', 'RW/C'], 'Kastelic, Mark': ['C', 'C/RW'], 'Namestnikov, Vladislav': ['C', 'C/LW'],
  'Räty, Aatu': ['C', 'C/LW'], 'Gadjovich, Jonah': ['L', 'LW/RW'], 'Björck, Viggo': ['C', 'C/RW'],
  'Fox, Adam': ['D', 'RD'], 'Edvinsson, Simon': ['D', 'LD'], 'Doughty, Drew': ['D', 'RD'],
  'Seeler, Nick': ['D', 'LD'], 'Hutson, Cole': ['D', 'LD'], 'Simashev, Dmitri': ['D', 'LD'],
  'Lamoureux, Maveric': ['D', 'RD'], 'Cullen, Wyatt': ['C', 'LW'], 'Boumedienne, Sascha': ['D', 'LD'],
  'MacKinnon, Nathan': ['C', 'C/RW'], 'Debrincat, Alex': ['R', 'RW/LW'], 'Rakell, Rickard': ['R', 'RW/C'],
  'Granlund, Mikael': ['C', 'C/LW'], 'Lehkonen, Artturi': ['L', 'LW/RW'], 'Minten, Fraser': ['C', 'C/LW'],
  'Arvidsson, Viktor': ['L', 'LW/RW'], 'O\'Connor, Drew': ['L', 'LW/RW'], 'Hartman, Ryan': ['R', 'RW/C'],
  'Steel, Sam': ['C', 'C/LW'], 'Noesen, Stefan': ['R', 'RW/LW'], 'Raddysh, Taylor': ['R', 'RW/LW'],
  'Dach, Colton': ['C', 'C/LW'], 'Klapka, Adam': ['R', 'RW/LW'], 'Chychrun, Jakob': ['D', 'LD'],
  'Pulock, Ryan': ['D', 'RD'], 'Ekholm, Mattias': ['D', 'LD'], 'Samberg, Dylan': ['D', 'LD'],
  'Roy, Matt': ['D', 'RD'], 'Korczak, Kaedan': ['D', 'RD'], 'Pachal, Brayden': ['D', 'RD'],
  'Gustafsson, Malte': ['D', 'LD'], 'Hagel, Brandon': ['L', 'LW'], 'Forsberg, Filip': ['L', 'LW/C'],
  'Kadri, Nazem': ['C', 'C/LW'], 'Stephenson, Chandler': ['C', 'C/LW'], 'McMichael, Connor': ['L', 'C'],
  'Roslovic, Jack': ['C', 'C/RW'], 'Lardis, Nick': ['L', 'LW/RW'], 'Kapanen, Kasperi': ['R', 'RW/C'],
  'Eklund, Victor': ['R', 'RW'], 'Danielson, Nate': ['C', 'C/RW'], 'Bear, Carter': ['L', 'LW/C'],
  'Halttunen, Kasper': ['R', 'RW/LW'], 'Hedman, Victor': ['D', 'LD'], 'Power, Owen': ['D', 'LD'],
  'Schmidt, Nate': ['D', 'LD'], 'Oleksiak, Jamie': ['D', 'LD'], 'DeAngelo, Tony': ['D', 'RD'],
  'Jiricek, David': ['D', 'RD'], 'Chiarot, Ben': ['D', 'LD'], 'Davies, Jeremy': ['D', 'LD'],
  'Larkin, Dylan': ['C', 'C/LW'], 'Blake, Jackson': ['R', 'RW/C'], 'Wennberg, Alexander': ['C', 'C/LW'],
  'Neighbours, Jake': ['L', 'LW/RW'], 'Lafrenière, Alexis': ['L', 'LW/RW'], 'Foegele, Warren': ['L', 'LW/C'],
  'Luostarinen, Eetu': ['C', 'C/LW'], 'Niederreiter, Nino': ['R', 'RW/LW'], 'Berggren, Jonatan': ['R', 'RW/LW'],
  'Washe, Tim': ['C', 'C/LW'], 'Protas, Ilya': ['L', 'LW/C'], 'Miroshnichenko, Ivan': ['L', 'LW'],
  'McGroarty, Rutger': ['C', 'RW/C'], 'Makar, Cale': ['D', 'RD'], 'Pelech, Adam': ['D', 'LD'],
  'Nikishin, Alexander': ['D', 'LD'], 'Gudas, Radko': ['D', 'RD'], 'Andrae, Emil': ['D', 'LD'],
  'Leddy, Nick': ['D', 'LD'], 'Korchinski, Kevin': ['D', 'LD'], 'Solberg, Stian': ['D', 'LD'],
  'Jarvis, Seth': ['R', 'RW/C'], 'Gauthier, Cutter': ['L', 'LW/RW'], 'Coronato, Matt': ['R', 'RW/LW'],
  'Leonard, Ryan': ['R', 'RW/C'], 'Finnie, Emmitt': ['C', 'C/LW'], 'Moore, Oliver': ['C', 'C/LW'],
  'Benn, Jamie': ['L', 'LW/C'], 'Helenius, Samuel': ['C', 'C/LW'], 'Melanson, Jacob': ['R', 'RW/LW'],
  'Kozak, Tyson': ['C', 'C/LW'], 'Werenski, Zach': ['D', 'LD'], 'Del Bel Belluz, Luca': ['C', 'C/LW'],
  'Stramel, Charlie': ['C', 'C/RW'], 'Nemec, Simon': ['D', 'RD'], 'York, Cam': ['D', 'LD'],
  'Schneider, Braden': ['D', 'RD'], 'Willander, Tom': ['D', 'RD'], 'Pettersson, Elias D': ['D', 'LD'],
  'Moore, Ian': ['D', 'RD'], 'Smits, Alberts': ['D', 'LD'], 'Plante, Max': ['C', 'LW/C'],
  'Barzal, Mathew': ['C', 'C/RW'], 'Byfield, Quinton': ['R', 'C/LW'], 'Quinn, Jack': ['R', 'RW/LW'],
  'Holmstrom, Simon': ['R', 'RW/LW'], 'Maccelli, Matias': ['L', 'LW/RW'], 'Ritchie, Calum': ['C', 'C/RW'],
  'Svechkov, Fyodor': ['C', 'C/LW'], 'Hoglander, Nils': ['L', 'LW/RW'], 'Öhgren, Liam': ['L', 'LW'],
  'Samanski, Josh': ['C', 'C/LW'], 'Eiserman, Cole': ['L', 'LW'], 'Howard, Isaac': ['L', 'LW/RW'],
  'Harley, Thomas': ['D', 'LD'], 'Chabot, Thomas': ['D', 'LD'], 'Nurse, Darnell': ['D', 'LD'],
  'Kaiser, Wyatt': ['D', 'LD'], 'Sandin Pellikka, Axel': ['D', 'RD'], 'Johansson, Albert': ['D', 'LD'],
  'Rinzel, Sam': ['D', 'RD'], 'Raymond, Lucas': ['L', 'RW/LW'], 'Lundell, Anton': ['C', 'C/LW'],
  'Martone, Porter': ['R', 'RW'], 'Benson, Zach': ['L', 'LW/C'], 'Dvorak, Christian': ['C', 'C/LW'],
  'Lee, Anders': ['L', 'LW'], 'Sissons, Colton': ['C', 'C/RW'], 'Gaudreau, Frederick': ['C', 'C/RW'],
  'Heineman, Emil': ['L', 'LW/RW'], 'Stenlund, Kevin': ['C', 'C/RW'], 'Barkey, Denver': ['C', 'C/LW'],
  'Frank, Ethen': ['R', 'RW'], 'Iginla, Tij': ['L', 'C/LW'], 'Sergachev, Mikhail': ['D', 'LD'],
  'Schaefer, Reid': ['L', 'LW'], 'Lindell, Esa': ['D', 'LD'], 'Drysdale, Jamie': ['D', 'RD'],
  'Jokiharju, Henri': ['D', 'RD'], 'Lindgren, Ryan': ['D', 'LD'], 'Yakemchuk, Carter': ['D', 'RD'],
  'Mrtka, Radim': ['D', 'RD'], 'Fortescue, Drew': ['D', 'LD'], 'Connor, Kyle': ['L', 'LW'],
  'Cover, Jaxon': ['L', 'RW/LW'], 'Snuggerud, Jimmy': ['R', 'RW'], 'Zacha, Pavel': ['C', 'C/LW'],
  'Buchnevich, Pavel': ['L', 'LW/C'], 'Paul, Nick': ['L', 'LW/C'], 'Amadio, Michael': ['R', 'RW/C'],
  'Duhaime, Brandon': ['R', 'LW/RW'], 'Smith, Reilly': ['R', 'RW/LW'], 'Dowd, Nic': ['C', 'C/RW'],
  'Josi, Roman': ['D', 'LD'], 'Burakovsky, Andre': ['L', 'LW/RW'], 'Demelo, Dylan': ['D', 'RD'],
  'Manson, Josh': ['D', 'RD'], 'Gavrikov, Vladislav': ['D', 'LD'], 'Cole, Ian': ['D', 'LD'],
  'McDonagh, Ryan': ['D', 'LD'], 'Schenn, Luke': ['D', 'RD'], 'Silayev, Anton': ['D', 'LD'],
  'Grzelcyk, Matt': ['D', 'LD'], 'Nestrasil, Vaclav': ['R', 'RW'], 'Johnston, Wyatt': ['C', 'C/RW'],
  'Verhaeghe, Carter': ['C', 'LW/C'], 'Wilson, Tom': ['R', 'RW'], 'Nelson, Brock': ['C', 'C/LW'],
  'Seguin, Tyler': ['C', 'C/RW'], 'Malenstyn, Beck': ['L', 'LW/RW'], 'Toropchenko, Alexei': ['R', 'RW/LW'],
  'Robinson, Eric': ['L', 'LW/RW'], 'James, Dominic': ['C', 'C/LW'], 'Bump, Alex': ['L', 'LW'],
  'Byram, Bowen': ['D', 'LD'], 'Parayko, Colton': ['D', 'RD'], 'Fix-Wolansky, Trey': ['R', 'RW/LW'],
  'Zadorov, Nikita': ['D', 'LD'], 'Girard, Samuel': ['D', 'LD'], 'van Riemsdyk, Trevor': ['D', 'RD'],
  'Ceci, Cody': ['D', 'RD'], 'Luneau, Tristan': ['D', 'RD'], 'Sokolovsky, Maxim': ['D', 'LD'],
  'Pugachyov, Gleb': ['R', 'RW'], 'Demidov, Ivan': ['R', 'RW/C'], 'Smith, Will': ['C', 'C/RW'],
  'Dorofeyev, Pavel': ['R', 'LW/RW'], 'Foerster, Tyson': ['R', 'RW'], 'Yurov, Danila': ['R', 'RW/C'],
  'Lindholm, Elias': ['C', 'C/RW'], 'McKenna, Gavin': ['L', 'LW'], 'O\'Connor, Logan': ['R', 'RW/C'],
  'Dvorský, Dalibor': ['R', 'RW/C'], 'But, Daniil': ['L', 'LW/RW'], 'Brindley, Gavin': ['R', 'C/RW/LW'],
  'Bystedt, Filip': ['C', 'C/LW'], 'McQueen, Roger': ['C', 'C/RW'], 'Heiskanen, Miro': ['D', 'LD'],
  'Samuelsson, Mattias': ['D', 'LD'], 'Larsson, Adam': ['D', 'RD'], 'Severson, Damon': ['D', 'RD'],
  'Dumoulin, Brian': ['D', 'LD'], 'Parekh, Zayne': ['D', 'RD'], 'Aitcheson, Kashawn': ['D', 'LD'],
  'Jones, Zachary': ['D', 'LD'], 'Smith, Jackson': ['D', 'LD'], 'Robertson, Jason': ['L', 'LW/RW'],
  'Tuch, Alex': ['R', 'RW'], 'Tkachuk, Brady': ['L', 'LW'], 'Hintz, Roope': ['C', 'C/LW'],
  'McCann, Jared': ['L', 'C'], 'McLeod, Ryan': ['C', 'C/LW'], 'Tarasenko, Vladimir': ['R', 'RW/LW'],
  'McBain, Jack': ['C', 'C/LW'], 'Kane, Evander': ['L', 'LW/RW'], 'Faksa, Radek': ['C', 'C/LW'],
  'Soderblom, Elmer': ['L', 'LW/RW'], 'MacDermid, Kurtis': ['L', 'LW/LD'], 'Parssinen, Juuso': ['C', 'C/LW'],
  'Brodin, Jonas': ['D', 'LD'], 'Connelly, Trevor': ['L', 'LW'], 'Mikkola, Niko': ['D', 'LD'],
  'Cernak, Erik': ['D', 'RD'], 'Spence, Jordan': ['D', 'RD'], 'Struble, Jayden': ['D', 'LD'],
  'Lyubushkin, Ilya': ['D', 'RD'], 'Soucy, Carson': ['D', 'LD'], 'Rudolph, Daxon': ['D', 'RD'],
  'Kucherov, Nikita': ['R', 'RW'], 'Letourneau, Dean': ['C', 'C/RW'], 'Guentzel, Jake': ['C', 'LW'],
  'Thomas, Robert': ['C', 'C/RW'], 'Podkolzin, Vasily': ['R', 'RW'], 'Gritsyuk, Arseny': ['R', 'RW'],
  'Olofsson, Victor': ['R', 'LW/RW'], 'Palmieri, Kyle': ['C', 'C/RW'], 'Kelly, Parker': ['C', 'C/LW'],
  'Bunting, Michael': ['L', 'LW/RW'], 'Eyssimont, Michael': ['C', 'C/LW/RW'], 'Kiviranta, Joel': ['L', 'LW/RW'],
  'Karlsson, Erik': ['D', 'RD'], 'Gostisbehere, Shayne': ['D', 'LD'], 'Faulk, Justin': ['D', 'RD'],
  'Lindholm, Hampus': ['D', 'LD'], 'Shea, Ryan': ['D', 'LD'], 'Kleven, Tyler': ['D', 'LD'],
  'Emberson, Ty': ['D', 'RD'], 'Mailloux, Logan': ['D', 'RD'], 'Morrow, Scott': ['D', 'RD'],
  'Hughes, Jack': ['C', 'C/LW'], 'Tavares, John': ['C', 'C/LW'], 'Frost, Morgan': ['C', 'C/LW'],
  'Graf, Collin': ['R', 'RW/C'], 'Hyman, Zach': ['L', 'LW/C'], 'Brazeau, Justin': ['R', 'RW/LW'],
  'Karlsson, Linus': ['C', 'C/RW'], 'Dickinson, Jason': ['C', 'C/LW'], 'Goncalves, Gage': ['C', 'C/LW'],
  'Lizotte, Blake': ['C', 'C/LW'], 'Edstrom, Adam': ['C', 'C/LW/RW'], 'Greentree, Liam': ['R', 'RW'],
  'Czata, Ethan': ['C', 'C/RW'], 'Sanheim, Travis': ['D', 'LD'], 'Provorov, Ivan': ['D', 'LD'],
  'Fehervary, Martin': ['D', 'LD'], 'Myers, Tyler': ['D', 'RD'], 'Dickinson, Sam': ['D', 'LD'],
  'Chisholm, Declan': ['D', 'LD'], 'Bernard-Docker, Jacob': ['D', 'RD'], 'Hemming, Oscar': ['C', 'LW'],
  'Pastrnak, David': ['R', 'RW'], 'Rust, Bryan': ['R', 'RW/LW'], 'Hall, Taylor': ['L', 'LW/C'],
  'Trenin, Yakov': ['C', 'C/LW'], 'Moore, Trevor': ['L', 'LW/C'], 'McCarron, Michael': ['C', 'C/RW'],
  'Nyquist, Gustav': ['C', 'RW/C'], 'Lomberg, Ryan': ['L', 'LW/RW'], 'Hryckowian, Justin': ['C', 'C/LW'],
  'Deslauriers, Nicolas': ['L', 'LW/LD'], 'Rempe, Matt': ['C', 'C/RW'], 'Hermansson, Elton': ['R', 'RW/LW'],
  'Nordmark, Marcus': ['L', 'LW/RW'], 'Kantserov, Roman': ['R', 'RW/C'], 'Montour, Brandon': ['D', 'RD'],
  'Malinski, Sam': ['D', 'RD'], 'Ekman-Larsson, Oliver': ['D', 'LD'], 'Marino, John': ['D', 'RD'],
  'Dillon, Brenden': ['D', 'LD'], 'Blankenburg, Nick': ['D', 'RD'], 'Lilleberg, Emil': ['D', 'LD'],
  'Marchenko, Kirill': ['R', 'RW/LW'], 'Protas, Aliaksei': ['L', 'C'], 'Doan, Josh': ['R', 'RW/C'],
  'Coyle, Charlie': ['C', 'C/RW'], 'Voronkov, Dmitri': ['L', 'LW/C'], 'Huberdeau, Jonathan': ['L', 'LW/RW'],
  'Sillinger, Cole': ['C', 'C/LW'], 'Greenway, Jordan': ['L', 'LW/C'], 'Cotter, Paul': ['L', 'LW/C'],
  'Jeannot, Tanner': ['L', 'LW/RW'], 'Kotkaniemi, Jesperi': ['C', 'C/LW'], 'Bouchard, Evan': ['D', 'RD'],
  'Miller, K\'Andre': ['D', 'LD'], 'Mateychuk, Denton': ['D', 'LD'], 'Romanov, Alexander': ['D', 'LD'],
  'Evans, Ryker': ['D', 'LD'], 'Tucker, Tyler': ['D', 'LD'], 'Legault, Charles-Alexis': ['D', 'RD'],
  'Pickering, Owen': ['D', 'LD'], 'Pickford, Bryce': ['D', 'RD'], 'Mittelstadt, Luke': ['D', 'LD'],
  'Marchand, Brad': ['L', 'LW'], 'Bennett, Sam': ['C', 'C/LW'], 'Barbashev, Ivan': ['L', 'LW'],
  'Tippett, Owen': ['R', 'RW/LW'], 'Bowman, Braeden': ['R', 'RW/LW'], 'Samoskevich, Mackie': ['R', 'RW/C'],
  'Mikheyev, Ilya': ['R', 'RW/LW'], 'Copp, Andrew': ['C', 'C/LW'], 'Lundestrom, Isac': ['C', 'C/LW'],
  'Compher, J.T.': ['L', 'LW/C'], 'Misa, Michael': ['C', 'C/LW'], 'L\'Heureux, Zachary': ['L', 'LW/C'],
  'Lakovic, Lynden': ['L', 'LW/RW'], 'Dahlin, Rasmus': ['D', 'LD'], 'Seider, Moritz': ['D', 'RD'],
  'Broberg, Philip': ['D', 'LD'], 'Trouba, Jacob': ['D', 'RD'], 'Crevier, Louis': ['D', 'RD'],
  'Ferraro, Mario': ['D', 'LD'], 'Perunovich, Scott': ['D', 'LD'], 'Bleyl, Tommy': ['D', 'RD'],
  'Carlsson, Leo': ['C', 'C/LW'], 'Cozens, Dylan': ['C', 'C/RW'], 'Holloway, Dylan': ['L', 'LW/C'],
  'Meier, Timo': ['R', 'RW/LW'], 'Mercer, Dawson': ['C', 'C/RW'], 'Texier, Alexandre': ['L', 'LW/C'],
  'Greig, Ridly': ['C', 'C/LW'], 'Beauvillier, Anthony': ['R', 'RW/LW'], 'Kasper, Marco': ['C', 'C/LW'],
  'Bastian, Nathan': ['R', 'RW/C'], 'Hathaway, Garnet': ['R', 'RW/LW'], 'Holtz, Alexander': ['R', 'RW/LW'],
  'Schaefer, Matthew': ['D', 'LD'], 'Lambert, Brad': ['C', 'C/RW'], 'Unger Sörum, Felix': ['R', 'RW/LW'],
  'Andersson, Rasmus': ['D', 'RD'], 'Whitecloud, Zach': ['D', 'RD'], 'Anderson, Mikey': ['D', 'LD'],
  'Stanley, Logan': ['D', 'LD'], 'Barron, Justin': ['D', 'RD'], 'Salomonsson, Elias': ['D', 'RD'],
  'Carels, Carson': ['D', 'LD'], 'Lin, Ryan': ['D', 'RD'], 'Lee, Ryker': ['R', 'RW'],
  'Barkov, Aleksander': ['C', 'C/LW'], 'Geekie, Morgan': ['C', 'C/RW'], 'Peterka, JJ': ['R', 'RW/LW'],
  'Boeser, Brock': ['R', 'RW/LW'], 'Olivier, Mathieu': ['R', 'RW/LW'], 'Sourdif, Justin': ['C', 'C/RW'],
  'Kreider, Chris': ['L', 'LW/RW'], 'Sherwood, Kiefer': ['L', 'LW/C'], 'Greer, A.J.': ['L', 'LW/RW'],
  'Lorentz, Steven': ['C', 'C/LW'], 'Yamamoto, Kailer': ['R', 'RW/LW'], 'Lafferty, Sam': ['C', 'C/RW'],
  'Gästrin, Milton': ['C', 'C/LW'], 'Dobson, Noah': ['D', 'RD'], 'Matheson, Mike': ['D', 'LD'],
  'Lauzon, Jeremy': ['D', 'LD'], 'Edmundson, Joel': ['D', 'LD'], 'Fabbro, Dante': ['D', 'RD'],
  'Desharnais, Vincent': ['D', 'RD'], 'Clifton, Connor': ['D', 'RD'], 'Kulikov, Dmitry': ['D', 'LD'],
  'Veilleux, Xavier': ['D', 'LD'], 'Schmaltz, Nick': ['C', 'C/RW'], 'Kane, Patrick': ['R', 'RW/LW'],
  'Giroux, Claude': ['R', 'C'], 'DeBrusk, Jake': ['L', 'LW'], 'Pezzetta, Michael': ['L', 'LW/C'],
  'Joshua, Dakota': ['C', 'C/LW'], 'Brodzinski, Jonny': ['C', 'C/RW'], 'Bjugstad, Nick': ['C', 'C/RW'],
  'Janmark, Mattias': ['C', 'LW/RW/C'], 'van Riemsdyk, James': ['L', 'LW/RW'], 'Palat, Ondrej': ['L', 'C/LW'],
  'Jankowski, Mark': ['L', 'C/LW'], 'Henrique, Adam': ['C', 'C/LW'], 'Goodrow, Barclay': ['C', 'C/LW'],
  'Glendening, Luke': ['C', 'C/RW'], 'Appleton, Mason': ['C', 'C/RW'], 'Steeves, Alex': ['C', 'C/LW/RW'],
  'Saad, Brandon': ['L', 'LW/RW'], 'Pearson, Tanner': ['L', 'LW/RW'], 'O\'Brien, Liam': ['C', 'C/LW'],
  'Mangiapane, Andrew': ['L', 'LW/RW/C'], 'MacLean, Kyle': ['C', 'C/LW'], 'Lazar, Curtis': ['C', 'C/RW'],
  'Jost, Tyson': ['C', 'C/LW'], 'Girgensons, Zemgus': ['C', 'C/LW'], 'Frederic, Trent': ['C', 'C/LW'],
  'Fabbri, Robby': ['C', 'C/LW'], 'Dadonov, Evgenii': ['R', 'RW/LW'], 'Cousins, Nick': ['C', 'C/LW'],
  'Tsyplakov, Maxim': ['R', 'RW/LW'], 'Meyers, Ben': ['C', 'C/LW'], 'Malott, Jeff': ['L', 'LW/RW'],
  'Laczynski, Tanner': ['C', 'C/RW'], 'Halonen, Brian': ['R', 'C/LW/RW'], 'Gregor, Noah': ['L', 'C/LW/RW'],
  'Wiesblatt, Ozzy': ['C', 'RW/C'], 'Ward, Taylor': ['R', 'RW/LW'], 'Tomasino, Philip': ['C', 'C/RW'],
  'Sheary, Conor': ['L', 'LW/RW'], 'Regenda, Pavol': ['L', 'LW/RW'], 'Leason, Brett': ['R', 'RW/C'],
  'Johnston, Ross': ['L', 'RW/LW'], 'Hallander, Filip': ['C', 'C/LW'], 'Gatcomb, Marc': ['C', 'RW/C'],
  'Erne, Adam': ['L', 'LW/RW'], 'Douglas, Curtis': ['C', 'C/LW'], 'Chaffee, Mitchell': ['R', 'RW'],
  'Viel, Jeffrey': ['L', 'LW/RW'], 'Tufte, Riley': ['L', 'LW/RW'], 'Toninato, Dominic': ['C', 'LW/C'],
  'Suzuki, Ryan': ['C', 'C/LW'], 'Slaggert, Landon': ['L', 'LW/C'], 'Shine, Dominik': ['R', 'RW/LW/C'],
  'Ostapchuk, Zack': ['C', 'LW/C'], 'Nesterenko, Nikita': ['C', 'RW/C/LW'], 'McLaughlin, Marc': ['C', 'C/RW'],
  'Leonard, John': ['L', 'LW/RW'], 'Kaliyev, Arthur': ['R', 'RW/LW'], 'Hyry, Arttu': ['R', 'RW/C'],
  'Guttman, Cole': ['C', 'C/RW'], 'Gustafsson, David': ['C', 'C/LW'], 'Dorwart, Karsen': ['L', 'LW/C'],
  'Stranges, Antonio': ['L', 'C/LW'], 'Shaw, Mason': ['C', 'C/LW'], 'Sabourin, Scott': ['R', 'RW/C/LW'],
  'Reinhardt, Cole': ['L', 'C/LW/RW'], 'Reaves, Ryan': ['R', 'RW/LW'], 'Poulin, Samuel': ['C', 'LW/RW/C'],
  'Pelletier, Jakob': ['L', 'LW/C'], 'Morton, Sam': ['C', 'C/LW'], 'Mazur, Carter': ['L', 'LW/RW'],
  'Lucchini, Jake': ['C', 'C/LW'], 'Lind, Kole': ['R', 'RW/LW'], 'Lee, Andre': ['L', 'LW/C'],
  'Kuntar, Trevor': ['C', 'C/LW'], 'Jones, Max': ['L', 'LW/RW'], 'Jones, Ben': ['C', 'C/LW'],
  'Hunt, Dryden': ['L', 'LW/RW'], 'Hughes, Cameron': ['C', 'C/LW'], 'Hayden, John': ['C', 'C/RW'],
  'Hamblin, James': ['L', 'C/LW'], 'Gaunce, Brendan': ['C', 'LW/C'], 'Gaucher, Jacob': ['C', 'C/RW'],
  'Foudy, Liam': ['C', 'C/LW'], 'Foote, Nolan': ['L', 'LW/RW'], 'Dube, Dillon': ['L', 'C/LW'],
  'Crookshank, Angus': ['L', 'LW/C/RW'], 'Blais, Sammy': ['L', 'LW/RW'], 'Bains, Arshdeep': ['L', 'LW/RW'],
  'Aston-Reese, Zach': ['C', 'LW/RW/C'], 'White, Colin': ['C', 'RW/C'], 'Studnicka, Jack': ['C', 'C/RW'],
  'Pitlick, Tyler': ['C', 'C/RW'], 'Pederson, Lane': ['C', 'C/RW'], 'Parent, Xavier': ['L', 'C/LW'],
  'Lettieri, Vinni': ['C', 'C/RW'], 'Huntington, Jimmy': ['C', 'C/LW'], 'Entwistle, Mackenzie': ['R', 'RW/LW/C'],
  'Duehr, Walker': ['R', 'RW'], 'Bordeleau, Thomas': ['C', 'C/LW'], 'Jaaska, Juha': ['L', 'C/LW/RW'],
  'Condotta, Lucas': ['C', 'LW/C'], 'Belzile, Alex': ['R', 'RW/C'], 'Sillinger, Owen': ['C', 'C/LW'],
  'Schmelzer, Ryan': ['C', 'C/RW'], 'Rooney, Kevin': ['C', 'C/LW'], 'Harvey-Pinard, Rafael': ['L', 'LW/RW'],
  'Vaakanainen, Urho': ['D', 'LD/RD'], 'Timmins, Conor': ['D', 'RD'], 'Petry, Jeff': ['D', 'RD'],
  'Hanley, Joel': ['D', 'LD/RD'], 'Bean, Jake': ['D', 'LD/RD'], 'Stastney, Spencer': ['D', 'LD'],
  'Matinpalo, Nikolas': ['D', 'RD/LD'], 'Gustafsson, Erik': ['D', 'LD'], 'Gudbranson, Erik': ['D', 'RD'],
  'Dumba, Matt': ['D', 'RD'], 'DeSimone, Nick': ['D', 'RD'], 'Solovyov, Ilya': ['D', 'LD/RD'],
  'Rosen, Calle': ['D', 'LD'], 'Robertson, Matthew': ['D', 'LD'], 'Petrovic, Alexander': ['D', 'RD'],
  'Juulsen, Noah': ['D', 'RD'], 'Hutton, Ben': ['D', 'LD/RD'], 'Carlile, Declan': ['D', 'LD'],
  'Capobianco, Kyle': ['D', 'RD'], 'Smith, Brendan': ['D', 'LD/RD'], 'Phillips, Isaak': ['D', 'LD/RD'],
  'Jones, Caleb': ['D', 'LD'], 'Hamonic, Travis': ['D', 'RD'], 'Cholowski, Dennis': ['D', 'LD'],
  'Thrun, Henry': ['D', 'LD'], 'Schueneman, Corey': ['D', 'LD'], 'Regula, Alec': ['D', 'RD'],
  'Rathbone, Jack': ['D', 'LD'], 'Mermis, Dakota': ['D', 'LD'], 'Lagesson, William': ['D', 'LD'],
  'Kolyachonok, Vladislav': ['D', 'LD'], 'Johnson, Ryan': ['D', 'LD'], 'Hunt, Daemon': ['D', 'LD/RD'],
  'Hicketts, Joe': ['D', 'LD'], 'Fitzgerald, Casey': ['D', 'RD'], 'Crotty, Cameron': ['D', 'RD'],
  'Bear, Ethan': ['D', 'RD'], 'Valimaki, Juuso': ['D', 'LD'], 'St. Ivany, Jack': ['D', 'LD'],
  'Metsa, Zach': ['D', 'RD'], 'Megna, Jaycob': ['D', 'LD'], 'McWard, Cole': ['D', 'RD'],
  'McIlrath, Dylan': ['D', 'RD'], 'Mackey, Connor': ['D', 'LD'], 'MacDonald, Jacob': ['D', 'LD/RD'],
  'Heinola, Ville': ['D', 'LD'], 'Englund, Andreas': ['D', 'LD'], 'Del Gaizo, Marc': ['D', 'LD/RD'],
  'Coghlan, Dylan': ['D', 'RD'], 'Bolduc, Samuel': ['D', 'LD'], 'Bjornfot, Tobias': ['D', 'LD'],
  'Bayreuther, Gavin': ['D', 'LD'], 'Ahcan, Jack': ['D', 'LD'], 'Pouliot, Derrick': ['D', 'LD'],
  'Middleton, Keaton': ['D', 'LD/RD'], 'Kiersted, Matt': ['D', 'LD'], 'Callahan, Michael': ['D', 'LD/RD'],
  'Burroughs, Kyle': ['D', 'RD/LD'], 'Attard, Ronald': ['D', 'RD'], 'Schuldt, Jimmy': ['D', 'LD'],
  'Gravel, Kevin': ['D', 'LD'], 'Brown, Josh': ['D', 'RD'], 'Formenton, Alex': ['L', 'LW'],
  'Nylander, Alex': ['R', 'RW'], 'Shaw, Logan': ['R', 'RW/C'], 'Griffith, Seth': ['C', 'C/RW'],
  'Seney, Brett': ['L', 'LW/C'], 'Watson, Austin': ['R', 'RW/LW'], 'Olofsson, Gustav': ['D', 'LD'],
  'Poganski, Austin': ['R', 'RW/LW'], 'McKeown, Roland': ['D', 'RD'], 'Paquette-Bisson, Tobie': ['D', 'LD/RD'],
  'Dermott, Travis': ['D', 'LD/RD'], 'Pinho, Brian': ['C', 'C/RW'], 'Boyd, Travis': ['C', 'C/RW'],
  'Peca, Matthew': ['L', 'LW/C'], 'Tynan, T.J.': ['C', 'C/RW'], 'Hakanpaa, Jani': ['D', 'LD'],
  'Carrick, Connor': ['D', 'RD'], 'Fasching, Hudson': ['C', 'C/RW/LW'], 'Bailey, Justin': ['R', 'RW/LW'],
  'Quenneville, David': ['D', 'RD'], 'Ritchie, Brett': ['R', 'RW'], 'Dube, Pierrick': ['R', 'RW'],
  'Wahlstrom, Oliver': ['R', 'RW/LW'], 'Phillips, Matthew': ['C', 'C/RW'], 'Benning, Matt': ['D', 'RD'],
};
function appliquerPositions() {
  const o = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ONGLET_JOUEURS);
  const valeurs = o.getRange(1, 1, o.getLastRow(), COL_EQUIPE_JOUEUR).getDisplayValues();
  const colonne = o.getRange(1, 8, valeurs.length, 1).getValues();   // H
  // Réécrite d'un bloc : on refuse s'il y a une formule dans H (elle serait remplacée par sa valeur).
  if (o.getRange(1, 8, valeurs.length, 1).getFormulas().some(f => f[0])) throw new Error('Formule dans la colonne H : arrêt, rien écrit.');
  const trouves = new Set(), autres = [];
  let n = 0;
  valeurs.forEach((l, i) => {
    const info = POSITIONS_NOUVELLES[String(l[COL_JOUEUR - 1]).trim()];
    if (!info || i < 1 || !String(l[COL_EQUIPE_JOUEUR - 1]).trim()) return;   // équipe ou UFA seulement
    trouves.add(String(l[COL_JOUEUR - 1]).trim());
    const actuelle = String(colonne[i][0]).trim();
    if (actuelle === info[0]) { colonne[i][0] = info[1]; n++; }
    else if (actuelle !== info[1]) autres.push(l[COL_JOUEUR - 1] + ' (' + actuelle + ')');
  });
  o.getRange(1, 8, colonne.length, 1).setValues(colonne);
  console.log(n + ' position(s) écrite(s). Modifiées depuis, non touchées : ' + (autres.join(', ') || 'aucune')
    + '. Introuvables : ' + (Object.keys(POSITIONS_NOUVELLES).filter(x => !trouves.has(x)).join(', ') || 'aucun') + '.');
}

// Lecture seule. Liste les formules (dédoublonnées en R1C1) qui citent PLAYERSDATABASE,
// pour savoir lesquelles dépendent des colonnes PO (H) / PO2 (I) avant de changer leur format.
function auditerFormulesPositions() {
  const classeur = SpreadsheetApp.openById(SHEET_ID);
  classeur.getSheets().forEach(o => {
    const n = o.getLastRow(), m = o.getLastColumn();
    if (!n || !m) return;
    const r1c1 = o.getRange(1, 1, n, m).getFormulasR1C1();
    const a1 = o.getRange(1, 1, n, m).getFormulas();
    const vus = new Map();
    r1c1.forEach((ligne, i) => ligne.forEach((f, j) => {
      if (!f) return;
      const texte = a1[i][j];
      // H ou I de PLAYERSDATABASE : plage directe, ou VLOOKUP depuis B avec l'index 7 (H) / 8 (I).
      const plage = /PLAYERSDATABASE!\$?[HI]\$?\d/i.test(texte);
      const vlookup = /PLAYERSDATABASE!\$?B\$?\d+:\$?[A-Z]+\$?\d+\s*,\s*[78]\s*,/i.test(texte);
      const local = o.getName() === ONGLET_JOUEURS && /(^|[^A-Z!])\$?[HI]\$?\d/.test(texte);
      if (!plage && !vlookup && !local) return;
      if (!vus.has(f)) vus.set(f, { n: 0, cellule: o.getRange(i + 1, j + 1).getA1Notation(), texte });
      vus.get(f).n++;
    }));
    if (vus.size) console.log('§ ' + o.getName() + ' : ' + [...vus.values()].map(v => v.cellule + ' x' + v.n + ' ' + v.texte.replace(/PLAYERSDATABASE!/g, 'P!').slice(0, 260)).join(' ¦ '));
  });
}

// À lancer à la main au besoin : remet tout l'onglet RESULTATS en texte. L'API lue par
// le site ignore les valeurs d'une colonne qui mélange nombres et texte.
function reparerResultats() {
  const o = ongletResultats();
  if (o.getLastRow() < 2) return;
  const rang = o.getRange(2, 1, o.getLastRow() - 1, RESULTATS_ENTETES.length);
  const valeurs = rang.getDisplayValues().map(l => l.map(v => /^\d+\.\d0%$/.test(v) ? v.replace(/0%$/, '%') : v));
  rang.setNumberFormat('@').setValues(valeurs);
  console.log(valeurs.length + ' ligne(s) remises en texte.');
}

function dossierResultats() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DOSSIER_RESULTATS');
  if (id) return DriveApp.getFolderById(id);
  const dossier = DriveApp.createFolder('LNHQ — Résultats des matchs');
  props.setProperty('DOSSIER_RESULTATS', dossier.getId());
  return dossier;
}

function soumettreResultat(d, membre) {
  const admin = peutModifier(membre);
  const code = codeDuMembre(membre);
  if (!code && !admin) return { ok: false, erreur: 'equipe' };
  const m = lireCalendrierGardiens().find(x => x.num === String(d.match || '').trim());
  if (!m) return { ok: false, erreur: 'match' };
  if (!admin && m.visiteur !== code && m.domicile !== code) return { ok: false, erreur: 'match' };
  if (m.date > finSemaineLigue()) return { ok: false, erreur: 'pas_joue' };

  const butsV = Number(d.butsV), butsD = Number(d.butsD), fin = String(d.fin || '');
  const entier = n => Number.isInteger(n) && n >= 0 && n <= 30;
  if (!entier(butsV) || !entier(butsD) || butsV === butsD) return { ok: false, erreur: 'score' };
  if (!FINS_MATCH.includes(fin) || (fin && Math.abs(butsV - butsD) !== 1)) return { ok: false, erreur: 'fin' };
  const stats = d.stats || {};
  const valeurStat = v => String(v == null ? '' : v).trim().slice(0, 12);

  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const o = ongletResultats();
    const lignes = o.getLastRow() > 1 ? o.getRange(2, 1, o.getLastRow() - 1, RESULTATS_ENTETES.length).getDisplayValues() : [];
    const i = lignes.findIndex(l => l[0] === m.num);
    if (i >= 0 && !admin) return { ok: false, erreur: 'deja_soumis' };
    // Photo facultative (résultat entré à la main) ; une correction sans nouvelle photo garde l'ancienne.
    let photo = i >= 0 ? lignes[i][RESULTATS_ENTETES.indexOf('Photo')] : '';
    if (d.photo && d.photo.data) {
      if (!TYPES_PHOTO.includes(d.photo.mime)) return { ok: false, erreur: 'photo' };
      const octets = Utilities.base64Decode(String(d.photo.data));
      if (!octets.length || octets.length > MAX_OCTETS_PHOTO) return { ok: false, erreur: 'photo' };
      const nom = 'match-' + m.num + '-' + m.visiteur + '-' + m.domicile + '-' + m.date + '.jpg';
      const fichier = dossierResultats().createFile(Utilities.newBlob(octets, d.photo.mime, nom));
      fichier.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photo = urlPhoto(fichier.getId());
    }

    const valeurs = [m.num, m.date, m.visiteur, m.domicile, String(butsV), String(butsD), fin]
      .concat(...RESULTATS_STATS.map(c => {
        const paire = Array.isArray(stats[c]) ? stats[c] : [];
        return [valeurStat(paire[0]), valeurStat(paire[1])];
      }))
      .concat([photo, code || 'Ligue', new Date().toISOString()]);
    // Format texte forcé sur la ligne avant d'écrire : appendRow convertirait « 74.5% » en nombre.
    const rang = o.getRange(i >= 0 ? i + 2 : o.getLastRow() + 1, 1, 1, valeurs.length);
    rang.setNumberFormat('@').setValues([valeurs]);
    // Score lisible directement dans le calendrier de la feuille.
    SpreadsheetApp.openById(SHEET_ID).getSheetByName(ONGLET_CALENDRIER).getRange(m.ligne, 6, 1, 2).setValues([[butsV, butsD]]);
    return { ok: true, match: m.num, photo: photo, correction: i >= 0 };
  } finally {
    verrou.releaseLock();
  }
}

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
  // Colonnes « Égalité » et « Tirage prévu » ajoutées après coup : en-tête posé si absent (format texte).
  [[COL_EGALITE, 'Égalité'], [COL_TIRAGE_PREVU, 'Tirage prévu']].forEach(([col, titre]) => {
    if (o.getRange(1, col).getValue() !== titre) {
      o.getRange(1, col).setValue(titre);
      o.getRange(1, col, o.getMaxRows(), 1).setNumberFormat('@');
    }
  });
  if (o.getLastRow() < 2) return [];
  return o.getRange(2, 1, o.getLastRow() - 1, ENCHERES_ENTETES.length).getDisplayValues().map((l, i) => ({
    rangee: i + 2, id: l[0], joueur: l[1], naissance: l[2], position: l[3], ov: l[4],
    equipe: l[5], mise: Number(l[6]) || 0, nb: Number(l[7]) || 0, debut: l[8], fin: l[9],
    statut: l[10], saison: l[11], egalite: l[13] ? l[13].split(',').map(c => c.trim()).filter(String) : [],
    tiragePrevu: l[14] || '',
  })).filter(e => e.id);
}

// Avant l'ouverture : on ne lance ni ne mise.
function encheresOuvertes() {
  return new Date() >= OUVERTURE_ENCHERES;
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
  encheres.filter(e => e.saison === config.saison).forEach(e => {
    if (e.statut === 'Terminée' && e.equipe === code) depenses += e.mise;
    // En tête, ou à égalité à 1000 jusqu'au tirage : jetons bloqués.
    else if ((e.statut === EN_COURS || e.statut === TIRAGE) && (e.equipe === code || e.egalite.includes(code))) engages += e.mise;
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

/* ---------- Plafond salarial ----------
   Onglet de la masse salariale (celui de lnhq.ca/masse.html) : colonne TM (code d'équipe)
   et PLAFOND = espace restant sous le plafond. Salaire d'un agent libre : 2026-27 (colonne N).
   Une équipe ne peut pas lancer ni miser si : salaire du joueur + salaires des joueurs des
   autres enchères où elle est en tête (ou à égalité) > son espace sous le plafond. */
const GID_MASSE = 900003016;
const COL_SALAIRE = 14;   // N  2026-27
const argent = v => Number(String(v || '').replace(/[^\d.-]/g, '')) || 0;

function espacesPlafond() {
  const o = SpreadsheetApp.openById(SHEET_ID).getSheets().find(s => s.getSheetId() === GID_MASSE);
  if (!o) throw new Error('Onglet de la masse salariale introuvable');
  const lignes = o.getDataRange().getDisplayValues();
  const entetes = lignes[0].map(h => String(h).trim().toUpperCase());
  const iCode = entetes.indexOf('TM'), iEspace = entetes.indexOf('PLAFOND');
  if (iCode < 0 || iEspace < 0) throw new Error('Colonnes TM / PLAFOND introuvables dans la masse salariale');
  const espaces = {};
  lignes.slice(1).forEach(l => { const c = String(l[iCode]).trim().toUpperCase(); if (c) espaces[c] = argent(l[iEspace]); });
  return espaces;
}

// Salaire 2026-27 des agents libres : « Nom, Prénom|naissance » → montant.
function salairesUfa() {
  const o = ongletEncheres(ONGLET_JOUEURS);
  const valeurs = o.getRange(2, COL_JOUEUR, o.getLastRow() - 1, COL_EQUIPE_JOUEUR - COL_JOUEUR + 1).getDisplayValues();
  const salaires = {};
  valeurs.forEach(l => {
    if (String(l[COL_EQUIPE_JOUEUR - COL_JOUEUR]).trim().toUpperCase() !== STATUT_UFA) return;
    salaires[l[0].trim() + '|' + l[5 - COL_JOUEUR].trim()] = argent(l[COL_SALAIRE - COL_JOUEUR]);
  });
  return salaires;
}

// null si ça passe ; sinon la réponse d'erreur « plafond » (avec les montants pour le message).
function depassePlafond(code, joueur, encheres, idActuel) {
  const salaires = salairesUfa();
  const salaire = salaires[joueur.nom + '|' + joueur.naissance] || 0;
  // Enchères gagnées dont le joueur est encore UFA (pas encore transféré dans l'équipe,
  // donc absent de la masse) : comptées aussi. Les joueurs transférés ne sont plus dans `salaires`.
  const engage = encheres
    .filter(e => e.id !== idActuel && (
      ((e.statut === EN_COURS || e.statut === TIRAGE) && (e.equipe === code || e.egalite.includes(code))) ||
      (e.statut === 'Terminée' && e.equipe === code)))
    .reduce((s, e) => s + (salaires[e.joueur + '|' + e.naissance] || 0), 0);
  const espace = espacesPlafond()[code];
  if (espace == null) return null;   // équipe absente de l'onglet : on ne bloque pas
  if (salaire + engage <= espace) return null;
  return { ok: false, erreur: 'plafond', salaire: salaire, engage: engage, espace: espace };
}

function lancerEnchere(d, membre) {
  const code = codeDuMembre(membre);
  if (!code) return { ok: false, erreur: 'equipe' };
  const montant = Math.floor(Number(d.montant));
  if (!encheresOuvertes()) return { ok: false, erreur: 'pas_ouvert', ouverture: OUVERTURE_ENCHERES.toISOString() };
  if (!(montant >= MISE_MINIMALE)) return { ok: false, erreur: 'minimum', minimum: MISE_MINIMALE };
  if (montant > MISE_MAXIMALE) return { ok: false, erreur: 'maximum', maximum: MISE_MAXIMALE };
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
    const plafond = depassePlafond(code, joueur, encheres, '');
    if (plafond) return plafond;

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
  if (!encheresOuvertes()) return { ok: false, erreur: 'pas_ouvert', ouverture: OUVERTURE_ENCHERES.toISOString() };
  if (montant > MISE_MAXIMALE) return { ok: false, erreur: 'maximum', maximum: MISE_MAXIMALE };
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const encheres = lireEncheres();
    const e = encheres.find(x => x.id === String(d.id || ''));
    const maintenant = new Date();
    if (!e || e.statut !== EN_COURS || new Date(e.fin) <= maintenant) return { ok: false, erreur: 'terminee' };
    if (e.equipe === code) return { ok: false, erreur: 'en_tete' };
    if (e.egalite.includes(code)) return { ok: false, erreur: 'deja_egalite' };
    const plafond = depassePlafond(code, { nom: e.joueur, naissance: e.naissance }, encheres, e.id);
    if (plafond) return plafond;
    const j = jetonsEquipe(code, encheres, lireJetons());

    // Déjà à 1000 : on peut seulement se joindre à l'égalité (le chrono ne bouge pas).
    if (e.mise >= MISE_MAXIMALE) {
      if (montant !== MISE_MAXIMALE) return { ok: false, erreur: 'minimum', minimum: MISE_MAXIMALE };
      if (j.disponibles < montant) return { ok: false, erreur: 'jetons', disponibles: j.disponibles };
      e.egalite.push(code);
      e.nb += 1;
      ongletEncheres('ENCHERES').getRange(e.rangee, 8).setValue(e.nb);
      ongletEncheres('ENCHERES').getRange(e.rangee, COL_EGALITE).setValue(e.egalite.join(','));
      ongletEncheres('MISES').appendRow([maintenant.toISOString(), e.id, e.joueur, code, montant]);
      return { ok: true, id: e.id, egalite: true, discord: { flux: 'AGENTS', message: messageEnchere('egalite', e, code) } };
    }

    // Vérifié ici, sous verrou : une mise envoyée juste avant la nôtre a pu changer le minimum.
    // Dès 981, +20 dépasserait 1000 : la mise suivante est 1000.
    const minimum = Math.min(e.mise + SURENCHERE_MINIMALE, MISE_MAXIMALE);
    if (!(montant >= minimum)) return { ok: false, erreur: 'minimum', minimum: minimum };
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
      // Égalité à 1000 : le joueur reste UFA jusqu'au tirage (jetons toujours bloqués).
      if (e.egalite.length) {
        e.statut = TIRAGE;
        ongletEncheres('ENCHERES').getRange(e.rangee, 11).setValue(e.statut);
        messages.push({ flux: 'AGENTS', message: messageEnchere('attente_tirage', e) });
        return;
      }
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

// Tirage au sort d'une enchère à égalité (sous verrou, appelé par les deux fonctions
// suivantes). Chaque équipe a la même chance. Le joueur passe au gagnant ; les autres
// retrouvent leurs 1000 jetons (l'enchère n'est plus « Tirage »). Après le tirage :
// F = gagnant, N = les autres candidats (la liste complète reste donc lisible).
function effectuerTirage(e, auteur) {
  const candidats = [e.equipe].concat(e.egalite);
  const gagnant = candidats[Math.floor(Math.random() * candidats.length)];
  const joueur = trouverAgentLibre(e.joueur, e.naissance);
  if (joueur) ongletEncheres(ONGLET_JOUEURS).getRange(joueur.rangee, COL_EQUIPE_JOUEUR).setValue(gagnant);
  else console.warn('Joueur introuvable (plus UFA ?) : ' + e.joueur);
  e.equipe = gagnant;
  e.egalite = candidats.filter(c => c !== gagnant);
  e.statut = 'Terminée';
  const o = ongletEncheres('ENCHERES');
  o.getRange(e.rangee, 6).setValue(gagnant);
  o.getRange(e.rangee, 11).setValue(e.statut);
  o.getRange(e.rangee, COL_EGALITE).setValue(e.egalite.join(','));
  console.log('Tirage ' + e.joueur + ' : ' + candidats.join(', ') + ' → ' + gagnant + ' (' + auteur + ')');
  return { id: e.id, gagnant: gagnant, candidats: candidats,
    discord: { flux: 'AGENTS', message: messageEnchere('tirage', e, '', !joueur, candidats) } };
}

// Admin seulement (publier.lnhq.ca) : tirage immédiat.
function tirerAuSort(d, membre) {
  if (!peutModifier(membre)) return { ok: false, erreur: 'admin' };
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const e = lireEncheres().find(x => x.id === String(d.id || ''));
    if (!e || e.statut !== TIRAGE) return { ok: false, erreur: 'pas_tirage' };
    return Object.assign({ ok: true }, effectuerTirage(e, 'par ' + membre.courriel));
  } finally {
    verrou.releaseLock();
  }
}

// Admin seulement : programme (ou reprogramme) l'heure du tirage. À l'heure, le Worker
// (tâche de chaque minute) appelle tirerAuSortAuto ; la page Enchères fait le spectacle.
// Possible d'avance, dès qu'il y a égalité à 1000 sur une enchère encore en cours : l'heure
// doit alors être après la fin du chrono (d'autres équipes peuvent égaler jusque-là).
function programmerTirage(d, membre) {
  if (!peutModifier(membre)) return { ok: false, erreur: 'admin' };
  const quand = new Date(String(d.quand || ''));
  if (isNaN(quand.getTime()) || quand.getTime() < Date.now() + 60000) return { ok: false, erreur: 'heure' };
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const e = lireEncheres().find(x => x.id === String(d.id || ''));
    const egaliteEnCours = e && e.statut === EN_COURS && e.egalite.length > 0;
    if (!e || (e.statut !== TIRAGE && !egaliteEnCours)) return { ok: false, erreur: 'pas_tirage' };
    if (egaliteEnCours && quand.getTime() < new Date(e.fin).getTime() + 60000) return { ok: false, erreur: 'avant_fin', fin: e.fin };
    e.tiragePrevu = quand.toISOString();
    ongletEncheres('ENCHERES').getRange(e.rangee, COL_TIRAGE_PREVU).setValue(e.tiragePrevu);
    console.log('Tirage programmé ' + e.joueur + ' : ' + e.tiragePrevu + ' (par ' + membre.courriel + ')');
    return { ok: true, id: e.id, quand: e.tiragePrevu,
      discord: { flux: 'AGENTS', message: messageEnchere('tirage_programme', e) } };
  } finally {
    verrou.releaseLock();
  }
}

// Appelée par le Worker (sans membre) : fait les tirages dont l'heure est arrivée.
function tirerAuSortAuto() {
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const maintenant = new Date();
    const dus = lireEncheres().filter(e => e.statut === TIRAGE && e.tiragePrevu && new Date(e.tiragePrevu) <= maintenant);
    return { ok: true, messages: dus.map(e => effectuerTirage(e, 'automatique').discord) };
  } finally {
    verrou.releaseLock();
  }
}

function nomEquipe(code) {
  return Object.keys(CODES_EQUIPES).find(nom => CODES_EQUIPES[nom] === code) || code;
}

function messageEnchere(type, e, precedente, joueurIntrouvable, candidats) {
  const fin = Math.floor(new Date(e.fin).getTime() / 1000);
  const prochaine = e.mise >= MISE_MAXIMALE
    ? 'Mise maximale atteinte : les autres équipes peuvent miser ' + MISE_MAXIMALE + ' aussi (égalité, tirage au sort).'
    : 'Prochaine mise minimale : ' + Math.min(e.mise + SURENCHERE_MINIMALE, MISE_MAXIMALE) + ' jetons';
  const joueur = e.joueur + (e.position || e.ov ? ' (' + [e.position, e.ov ? e.ov + ' OV' : ''].filter(String).join(', ') + ')' : '');
  const lignes = {
    nouvelle: [
      '**' + nomEquipe(e.equipe) + '** lance une enchère sur **' + joueur + '**.',
      'Mise de départ : **' + e.mise + ' jetons**',
      prochaine,
      'Fin : <t:' + fin + ':f> (<t:' + fin + ':R>)',
    ],
    surenchere: [
      '**' + nomEquipe(e.equipe) + '** mise **' + e.mise + ' jetons** sur **' + joueur + '**'
        + (precedente ? ' et devance ' + nomEquipe(precedente) : '') + '.',
      prochaine,
      'Fin : <t:' + fin + ':f> (<t:' + fin + ':R>)',
    ],
    egalite: [
      '**' + nomEquipe(precedente) + '** mise aussi **' + MISE_MAXIMALE + ' jetons** sur **' + joueur + '** : égalité.',
      'À égalité : ' + [e.equipe].concat(e.egalite).map(nomEquipe).join(', '),
      'Fin de l\'enchère : <t:' + fin + ':f> (<t:' + fin + ':R>) ; le tirage au sort en direct sera programmé ensuite par la ligue.',
    ],
    attente_tirage: [
      'Enchère terminée à égalité sur **' + joueur + '** (' + MISE_MAXIMALE + ' jetons).',
      'Équipes au tirage : ' + [e.equipe].concat(e.egalite).map(nomEquipe).join(', '),
      e.tiragePrevu
        ? 'Tirage au sort en direct sur la page des enchères : <t:' + Math.floor(new Date(e.tiragePrevu).getTime() / 1000) + ':F> (<t:'
          + Math.floor(new Date(e.tiragePrevu).getTime() / 1000) + ':R>) ; les autres équipes retrouveront leurs jetons.'
        : 'Le tirage au sort se fera en direct sur la page des enchères, à l\'heure que la ligue annoncera ; les autres équipes retrouveront leurs jetons.',
    ],
    tirage_programme: [
      'Tirage au sort pour **' + joueur + '** entre ' + [e.equipe].concat(e.egalite).map(nomEquipe).join(', ') + '.',
      'En direct sur la page des enchères : <t:' + Math.floor(new Date(e.tiragePrevu).getTime() / 1000) + ':F> (<t:'
        + Math.floor(new Date(e.tiragePrevu).getTime() / 1000) + ':R>)',
    ],
    tirage: [
      '🎲 Tirage au sort entre ' + (candidats || []).map(nomEquipe).join(', ') + '.',
      '**' + nomEquipe(e.equipe) + '** remporte **' + joueur + '** pour **' + e.mise + ' jetons**.',
      'Les autres équipes retrouvent leurs jetons.',
    ].concat(joueurIntrouvable ? ['⚠️ Joueur introuvable en UFA dans PLAYERSDATABASE : à inscrire à la main.'] : []),
    fin: [
      '**' + nomEquipe(e.equipe) + '** remporte **' + joueur + '** pour **' + e.mise + ' jetons**'
        + ' (' + e.nb + ' mise' + (e.nb > 1 ? 's' : '') + ').',
    ].concat(joueurIntrouvable ? ['⚠️ Joueur introuvable en UFA dans PLAYERSDATABASE : à inscrire à la main.'] : []),
  }[type];
  const titre = { nouvelle: '🆕 Nouvelle enchère', surenchere: '⬆️ Surenchère', fin: '🏁 Enchère terminée',
    egalite: '🟰 Égalité à ' + MISE_MAXIMALE, attente_tirage: '🎲 Tirage au sort à venir', tirage: '🎲 Tirage au sort',
    tirage_programme: '📅 Tirage au sort programmé' }[type];
  return {
    username: 'Agents libres · LNHQ',
    avatar_url: 'https://lnhq.ca/logo-lnhq.png',
    embeds: [{
      title: titre + ' : ' + e.joueur,
      url: 'https://lnhq.ca/encheres.html#e-' + e.id,
      description: lignes.join('\n'),
      color: type === 'fin' || type === 'tirage' ? 0x2F9E44 : /^(attente_tirage|egalite|tirage_programme)$/.test(type) ? 0x7048E8 : 0xE8590C,
      thumbnail: { url: 'https://lnhq.ca/Logos/' + e.equipe + '.png' },
    }],
    allowed_mentions: { parse: [] },
  };
}
