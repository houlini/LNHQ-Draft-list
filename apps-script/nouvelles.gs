/* =========================================================================
   LNHQ — publication des Nouvelles et des Annonces.
   À coller dans l'éditeur Apps Script du Google Form (Form → ⋮ → Éditeur de scripts).

   Réglages (Paramètres du projet → Propriétés du script) :
     WEBHOOK_URL          URL du webhook Discord (secrète : jamais dans ce fichier)
     ONGLET               NOUVELLES ou ANNONCES (défaut : NOUVELLES)
     PAGE_URL             page du site qui affiche le fil, ex. https://lnhq.ca/nouvelles-test.html
     COURRIELS_AUTORISES  facultatif, courriels séparés par des virgules ; vide = tout le monde

   Installation : choisir la fonction « installer » puis Exécuter, une seule fois.
   ========================================================================= */

const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';
const QUESTIONS = { titre: 'Titre', equipe: 'Équipe', type: 'Type', texte: 'Texte', photos: 'Photos' };
const ENTETES = ['Date', 'Équipe', 'Type', 'Titre', 'Texte', 'Photos', 'Visible', 'Épinglé', 'ID Discord', 'ID réponse'];
const COULEURS_TYPE = { 'Transaction': 0x1C7ED6, 'Résultat': 0x2F9E44, 'Blessure': 0xE03131, 'Général': 0xE8590C };

function installer() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('surEnvoi').forForm(FormApp.getActiveForm()).onFormSubmit().create();
}

function surEnvoi(e) {
  const reglages = PropertiesService.getScriptProperties().getProperties();
  const reponse = e.response;

  const autorises = (reglages.COURRIELS_AUTORISES || '').split(',')
    .map(c => c.trim().toLowerCase()).filter(Boolean);
  const courriel = (reponse.getRespondentEmail() || '').toLowerCase();
  if (autorises.length && !autorises.includes(courriel)) {
    console.warn('Envoi ignoré, courriel non autorisé : ' + courriel);
    return;
  }

  const v = lireReponse(reponse);
  v.photos.forEach(id => DriveApp.getFileById(id)
    .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW));

  const verrou = LockService.getScriptLock();
  verrou.waitLock(30000);
  try {
    const onglet = ouvrirOnglet(reglages.ONGLET || 'NOUVELLES');
    const idReponse = reponse.getId();
    // Une réponse modifiée par son auteur redéclenche l'envoi : on met à jour sa ligne
    // en gardant la date d'origine et les cases Visible/Épinglé choisies par la ligue.
    const ligne = trouverLigne(onglet, idReponse);
    const date = ligne ? onglet.getRange(ligne, 1).getValue() : reponse.getTimestamp();
    const idDiscordExistant = ligne ? onglet.getRange(ligne, 9).getDisplayValue() : '';
    const pageUrl = (reglages.PAGE_URL || 'https://lnhq.ca/') + '#n-' + idReponse;
    const idDiscord = publierDiscord(reglages.WEBHOOK_URL, v, date, pageUrl, idDiscordExistant);

    const valeurs = [date, v.equipe, v.type, v.titre, v.texte, v.photos.join(',')];
    if (ligne) {
      onglet.getRange(ligne, 1, 1, valeurs.length).setValues([valeurs]);
      onglet.getRange(ligne, 9).setValue(idDiscord);
    } else {
      onglet.appendRow(valeurs.concat([true, false, idDiscord, idReponse]));
      const cases = onglet.getRange(onglet.getLastRow(), 7, 1, 2);
      cases.insertCheckboxes();
      cases.setValues([[true, false]]);
    }
  } finally {
    verrou.releaseLock();
  }
}

function lireReponse(reponse) {
  const parTitre = {};
  reponse.getItemResponses().forEach(ir => { parTitre[ir.getItem().getTitle().trim()] = ir.getResponse(); });
  const texte = question => String(parTitre[question] || '').trim();
  const photos = parTitre[QUESTIONS.photos];
  return {
    titre: texte(QUESTIONS.titre),
    equipe: texte(QUESTIONS.equipe) || 'Ligue',
    type: texte(QUESTIONS.type) || 'Général',
    texte: texte(QUESTIONS.texte),
    photos: Array.isArray(photos) ? photos : [],
  };
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

function trouverLigne(onglet, idReponse) {
  const n = onglet.getLastRow() - 1;
  if (n < 1) return 0;
  const i = onglet.getRange(2, 10, n, 1).getDisplayValues().findIndex(([id]) => id === idReponse);
  return i === -1 ? 0 : i + 2;
}

function publierDiscord(webhook, v, date, pageUrl, idExistant) {
  if (!webhook) {
    console.warn('WEBHOOK_URL manquant : rien publié sur Discord.');
    return idExistant;
  }
  const principal = {
    title: tronquer(v.titre, 256),
    url: pageUrl,
    description: tronquer(v.texte, 4000),
    color: COULEURS_TYPE[v.type] || COULEURS_TYPE['Général'],
    footer: { text: v.type + ' · ' + v.equipe },
    timestamp: new Date(date).toISOString(),
  };
  const embeds = [principal];
  if (v.photos.length) principal.image = { url: urlPhoto(v.photos[0]) };
  // Discord regroupe en galerie les embeds qui partagent la même url (4 images au total).
  v.photos.slice(1, 4).forEach(id => embeds.push({ url: pageUrl, image: { url: urlPhoto(id) } }));

  const rep = UrlFetchApp.fetch(idExistant ? webhook + '/messages/' + idExistant : webhook + '?wait=true', {
    method: idExistant ? 'patch' : 'post',
    contentType: 'application/json',
    // Aucune mention (@everyone, @here, rôles) : le Form Nouvelles est ouvert à tous.
    payload: JSON.stringify({ embeds: embeds, allowed_mentions: { parse: [] } }),
    muteHttpExceptions: true,
  });
  if (rep.getResponseCode() >= 300) {
    console.error('Discord a refusé (' + rep.getResponseCode() + ') : ' + rep.getContentText());
    return idExistant;
  }
  return idExistant || JSON.parse(rep.getContentText()).id;
}

function urlPhoto(id) {
  return 'https://lh3.googleusercontent.com/d/' + id + '=w1600';
}

function tronquer(texte, max) {
  return texte.length > max ? texte.slice(0, max - 1) + '…' : texte;
}
