/* =========================================================================
   LNHQ — application web de publication (Nouvelles et Annonces).
   À coller dans l'éditeur Apps Script du classeur PRIVÉ « LNHQ — Accès »
   (Extensions → Apps Script). Appelée uniquement par le Worker Cloudflare de
   publier.lnhq.ca, qui a déjà vérifié le courriel de la personne avec Access.

   Installation : exécuter « installer » une fois (crée l'onglet ACCES, le dossier
   des photos et le code secret partagé avec le Worker), puis Déployer → Nouveau
   déploiement → Application Web : « Exécuter en tant que : moi »,
   « Qui a accès : Tout le monde ».

   Réglages (Paramètres du projet → Propriétés du script) :
     WEBHOOK_NOUVELLES, WEBHOOK_ANNONCES   webhooks Discord (secrets)
     PAGE_NOUVELLES, PAGE_ANNONCES         pages du site, pour les liens Discord
   ========================================================================= */

const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';
const ONGLET_ACCES = 'ACCES';
const ONGLET_JOURNAL = 'JOURNAL';
const TYPES = ['Général', 'Transaction', 'Résultat', 'Blessure'];
const EQUIPES = [
  'Anaheim', 'Boston', 'Buffalo', 'Calgary', 'Caroline', 'Chicago', 'Colorado', 'Columbus',
  'Dallas', 'Detroit', 'Edmonton', 'Floride', 'Los Angeles', 'Minnesota', 'Montréal', 'Nashville',
  'New Jersey', 'NY Islanders', 'NY Rangers', 'Ottawa', 'Philadelphie', 'Pittsburgh', 'San Jose',
  'Seattle', 'St. Louis', 'Tampa Bay', 'Toronto', 'Utah', 'Vancouver', 'Vegas', 'Washington', 'Winnipeg',
];
const ENTETES = ['Date', 'Équipe', 'Type', 'Titre', 'Texte', 'Photos', 'Visible', 'Épinglé', 'ID Discord', 'ID réponse'];
const COULEURS_TYPE = { 'Transaction': 0x1C7ED6, 'Résultat': 0x2F9E44, 'Blessure': 0xE03131, 'Général': 0xE8590C };
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
  if (p.action === 'photo') return photoSeule(JSON.parse(corps || '{}'));
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
  const titre = String(d.titre || '').trim().slice(0, 200);
  const texte = String(d.texte || '').trim().slice(0, 20000);
  if (!titre || !texte) return { ok: false, erreur: 'vide' };
  if (d.couverture && !TYPES_PHOTO.includes(d.couverture.mime)) return { ok: false, erreur: 'photo' };

  const v = {
    titre: titre,
    texte: texte,
    type: TYPES.includes(d.type) ? d.type : 'Général',
    // L'équipe vient de la liste d'accès, jamais du navigateur.
    equipe: flux === 'ANNONCES' ? 'Ligue' : membre.equipe,
    // Colonne Photos du classeur : la couverture seulement ; les autres images sont dans le texte.
    photos: d.couverture ? [enregistrerPhoto(d.couverture)] : [],
  };

  const reglages = PropertiesService.getScriptProperties().getProperties();
  const id = Utilities.getUuid();
  const date = new Date();
  const pageUrl = (reglages['PAGE_' + flux] || 'https://lnhq.ca/') + '#n-' + id;

  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const idDiscord = publierDiscord(reglages['WEBHOOK_' + flux], v, date, pageUrl);
    const onglet = ouvrirOnglet(flux);
    onglet.appendRow([date, v.equipe, v.type, v.titre, v.texte, v.photos.join(','), true, false, idDiscord, id]);
    const cases = onglet.getRange(onglet.getLastRow(), 7, 1, 2);
    cases.insertCheckboxes();
    cases.setValues([[true, false]]);
    // L'auteur reste dans ce classeur privé, jamais dans le classeur public.
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ONGLET_JOURNAL)
      .appendRow([date, membre.courriel, flux, v.titre, id]);
  } finally {
    verrou.releaseLock();
  }
  return { ok: true, id: id, page: pageUrl };
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

function publierDiscord(webhook, v, date, pageUrl) {
  if (!webhook) {
    console.warn('Webhook Discord manquant : rien publié sur Discord.');
    return '';
  }
  const discord = texteDiscord(v.texte);
  const images = v.photos.map(urlPhoto).concat(discord.images);
  const principal = {
    title: tronquer(v.titre, 256),
    url: pageUrl,
    description: tronquer(discord.texte, 4000),
    color: COULEURS_TYPE[v.type] || COULEURS_TYPE['Général'],
    footer: { text: v.type + ' · ' + v.equipe },
    timestamp: date.toISOString(),
  };
  const embeds = [principal];
  if (images.length) principal.image = { url: images[0] };
  // Discord regroupe en galerie les embeds qui partagent la même url (4 images au total).
  images.slice(1, 4).forEach(url => embeds.push({ url: pageUrl, image: { url: url } }));

  const rep = UrlFetchApp.fetch(webhook + '?wait=true', {
    method: 'post',
    contentType: 'application/json',
    // Aucune mention (@everyone, @here, rôles) possible depuis le texte d'une nouvelle.
    payload: JSON.stringify({ embeds: embeds, allowed_mentions: { parse: [] } }),
    muteHttpExceptions: true,
  });
  if (rep.getResponseCode() >= 300) {
    console.error('Discord a refusé (' + rep.getResponseCode() + ') : ' + rep.getContentText());
    return '';
  }
  return JSON.parse(rep.getContentText()).id;
}

// Discord ne sait afficher ni images dans le texte, ni couleurs, ni tableaux :
// les images passent en galerie, les couleurs sont retirées, les tableaux deviennent
// un bloc de texte à largeur fixe (colonnes alignées).
function texteDiscord(texte) {
  const images = [];
  let t = texte.replace(/!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/g, (m, url) => { images.push(url); return ''; });
  t = t.replace(/<\/?span[^>]*>/gi, '');
  t = t.replace(/(^\|.*\|[ \t]*$\n?)+/gm, bloc => '```\n' + bloc.trimEnd() + '\n```\n');
  return { texte: t.replace(/\n{3,}/g, '\n\n').trim(), images: images };
}

function urlPhoto(id) {
  return 'https://lh3.googleusercontent.com/d/' + id + '=w1600';
}

function tronquer(texte, max) {
  return texte.length > max ? texte.slice(0, max - 1) + '…' : texte;
}
