// LNHQ — Worker de l'espace des DG : sert les pages (dossier public/) et relaie les
// envois vers l'application web Apps Script, avec l'identité vérifiée ici.
//  - dg.lnhq.ca : connexion Discord (session signée par ce Worker), identité « discord:<id> ».
//  - publier.lnhq.ca : ancienne adresse derrière Cloudflare Access (courriel), le temps
//    que chaque DG lie son compte Discord (/lier-discord.html).

const MAX_OCTETS_ENVOI = 20 * 1024 * 1024;
const HOTE_DG = 'dg.lnhq.ca';
const RETOUR_DISCORD = 'https://dg.lnhq.ca/auth/discord';
const COOKIE_SESSION = 'lnhq_dg';
const COOKIE_ETAT = 'lnhq_etat';
const DUREE_SESSION = 30 * 24 * 3600;   // secondes

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const surDg = url.hostname === HOTE_DG;
    if (url.pathname.startsWith('/auth/')) return authentification(request, env, url);
    if (!url.pathname.startsWith('/api/')) {
      // Les pages de dg.lnhq.ca demandent d'abord la connexion Discord (CSS, scripts et
      // images restent servis : sans l'API, ils ne montrent rien de privé).
      if (surDg && estPage(url.pathname) && !(await lireSession(request, env))) {
        return pageConnexion(url.pathname + url.search);
      }
      return env.ASSETS.fetch(request);
    }

    let courriel;
    let session = null;
    if (surDg) {
      session = await lireSession(request, env);
      if (!session) return json({ ok: false, erreur: 'acces' }, 401);
      courriel = 'discord:' + session.id;
    } else {
      try {
        courriel = await verifierAcces(request, env);
      } catch (err) {
        console.warn('Accès refusé :', err.message);
        // Jeton d'une ancienne configuration d'Access (ex. avant le changement de nom de
        // l'équipe) : sa page de déconnexion n'existe plus, alors on efface le cookie ici.
        // Au rechargement, Access redemande un code par courriel.
        const rep = json({ ok: false, erreur: 'acces' }, 403);
        rep.headers.append('Set-Cookie', 'CF_Authorization=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax');
        return rep;
      }
    }

    if (url.pathname === '/api/moi' && request.method === 'GET') {
      return appelerScript(env, 'moi', courriel);
    }
    // Lien du compte Discord, depuis publier.lnhq.ca (courriel vérifié par Access) : code
    // aléatoire de 10 minutes (le courriel reste dans KV, jamais dans l'adresse), repris
    // par /auth/discord après la connexion Discord.
    if (url.pathname === '/api/discord/lier' && request.method === 'POST' && !surDg) {
      const code = b64url(crypto.getRandomValues(new Uint8Array(18)));
      await env.LECTURES.put('lier:' + code, courriel, { expirationTtl: 600 });
      return json({ ok: true, url: `https://${HOTE_DG}/auth/discord/connexion?lier=${code}` });
    }
    // Demande d'accès d'un compte Discord pas encore membre (dg.lnhq.ca/inscription.html).
    if (url.pathname === '/api/inscription' && surDg) {
      if (request.method === 'GET') return appelerScript(env, 'statutDemande', courriel);
      if (request.method === 'POST') {
        const d = await request.json().catch(() => ({}));
        return appelerScript(env, 'demanderAcces', courriel, JSON.stringify({ equipe: String(d.equipe || ''), nom: session.nom || '' }));
      }
    }
    if (url.pathname === '/api/equipes' && request.method === 'GET') {
      return appelerScript(env, 'equipesInscrites', courriel);
    }
    if (url.pathname === '/api/admin/migration' && request.method === 'GET') {
      return appelerScript(env, 'migrationDiscord', courriel);
    }
    if (url.pathname === '/api/admin/resume' && request.method === 'GET') {
      const r = await scriptJson(env, 'resumeAdmin', courriel);
      // Date de la base des ratings (métadonnée KV, sans lire la base elle-même).
      if (r.ok) {
        const { value, metadata } = await env.RATINGS.getWithMetadata('joueurs', { type: 'stream' });
        if (value) await value.cancel();
        r.ratings = metadata?.misAJour || '';
      }
      return json(r, r.ok ? 200 : 400);
    }
    if (url.pathname === '/api/admin/acces' && request.method === 'POST') {
      return appelerScript(env, 'deciderAcces', courriel, await request.text());
    }
    if (url.pathname === '/api/article' && request.method === 'GET') {
      return appelerScript(env, 'lire', courriel, JSON.stringify({ id: url.searchParams.get('id') || '' }));
    }
    if (url.pathname === '/api/recentes' && request.method === 'GET') {
      return appelerScript(env, 'recentes', courriel);
    }
    if (url.pathname === '/api/reessayer' && request.method === 'POST') {
      return reessayerDiscord(env, courriel);
    }
    if (url.pathname === '/api/alignement/sauver' && request.method === 'POST') {
      return appelerScript(env, 'sauverAlignement', courriel, await request.text());
    }
    const gardien = { '/api/gardien/declarer': 'declarerGardien', '/api/gardien/retirer': 'retirerGardien' }[url.pathname];
    if (gardien && request.method === 'POST') {
      return appelerScript(env, gardien, courriel, await request.text());
    }
    const resultat = { '/api/resultat/lire': 'lire', '/api/resultat/soumettre': 'soumettreResultat' }[url.pathname];
    if (resultat && request.method === 'POST') {
      const taille = Number(request.headers.get('Content-Length') || 0);
      if (!taille || taille > MAX_OCTETS_ENVOI) return json({ ok: false, erreur: 'taille' }, 413);
      if (resultat === 'lire') return lirePhotoResultat(env, await request.json().catch(() => ({})), ctx);
      return appelerScript(env, resultat, courriel, await request.text());
    }
    const enchere = { '/api/encheres/lancer': 'lancerEnchere', '/api/encheres/miser': 'miserEnchere', '/api/encheres/tirage': 'tirerAuSort', '/api/encheres/programmer': 'programmerTirage' }[url.pathname];
    if (enchere && request.method === 'POST') {
      return actionEnchere(env, enchere, courriel, await request.text());
    }
    if (url.pathname === '/api/stats/importer' && request.method === 'POST') {
      const taille = Number(request.headers.get('Content-Length') || 0);
      if (!taille || taille > 2 * 1024 * 1024) return json({ ok: false, erreur: 'taille' }, 413);
      return appelerScript(env, 'importerStats', courriel, await request.text());
    }
    // Base des ratings NHL 27 : privée, servie seulement aux membres connectés par Access.
    if (url.pathname === '/api/ratings' && request.method === 'GET') {
      const { value, metadata } = await env.RATINGS.getWithMetadata('joueurs');
      if (!value) return json({ ok: false, erreur: 'vide' });
      return new Response('{"ok":true,"misAJour":' + JSON.stringify(metadata?.misAJour || '') + ',"joueurs":' + value + '}', {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
      });
    }
    if (url.pathname === '/api/transactions' && request.method === 'GET') {
      return appelerScript(env, 'transactions', courriel);
    }
    const transaction = { '/api/transactions/proposer': 'proposerTransaction', '/api/transactions/repondre': 'repondreTransaction',
      '/api/transactions/annuler': 'annulerTransaction' }[url.pathname];
    if (transaction && request.method === 'POST') {
      return actionTransaction(env, transaction, courriel, await request.text());
    }
    // Approbation : la transaction est publiée dans les nouvelles, comme une publication.
    const execution = { '/api/transactions/decider': 'deciderTransaction', '/api/transactions/enregistrer': 'enregistrerTransaction' }[url.pathname];
    if (execution && request.method === 'POST') {
      return publier(env, execution, courriel, await request.text());
    }
    const action = { '/api/publier': 'publier', '/api/modifier': 'modifier', '/api/photo': 'photo' }[url.pathname];
    if (action && request.method === 'POST') {
      const taille = Number(request.headers.get('Content-Length') || 0);
      if (!taille || taille > MAX_OCTETS_ENVOI) return json({ ok: false, erreur: 'taille' }, 413);
      if (action === 'photo') return appelerScript(env, action, courriel, request.body);
      return publier(env, action, courriel, await request.text());
    }
    return json({ ok: false, erreur: 'introuvable' }, 404);
  },

  // Chaque minute (wrangler.toml → crons) : ferme les enchères dont le chrono est écoulé.
  // Chaque minute : fermeture des enchères. Une fois par jour (16 h UTC = midi à
  // Montréal l'été, 11 h l'hiver) : rappels du 2e gardien.
  async scheduled(event, env, ctx) {
    if (event.cron === CRON_GARDIENS) ctx.waitUntil(rappelsGardiens(env));
    else ctx.waitUntil(cloturerEncheres(env));
  },
};

/* ---------- 2e gardien : rappels et fins de période (canal WEBHOOK_GARDIENS) ---------- */
const CRON_GARDIENS = '0 16 * * *';

async function rappelsGardiens(env) {
  // Canal des annonces tant qu'il n'y a pas de webhook propre au 2e gardien.
  const flux = env.WEBHOOK_GARDIENS ? 'GARDIENS' : 'ANNONCES';
  if (!env['WEBHOOK_' + flux]) return;
  try {
    const r = await scriptJson(env, 'rappelsGardiens', 'systeme');
    for (const msg of r.messages || []) {
      const envoi = await envoyerDiscord(env, flux, msg.message);
      if (envoi.erreur) console.error('Discord (2e gardien) :', envoi.erreur);
    }
  } catch (err) {
    console.error('Rappels 2e gardien :', err.message);
  }
}

/* ---------- Résultats : lecture de la photo de fin de match (Gemini) ---------- */
// Le DG vérifie toujours les valeurs avant d'envoyer : la lecture ne fait que
// préremplir le formulaire. Secret GEMINI_KEY (clé de Google AI Studio).
const STATS_RESULTAT = {
  tirs: 'TOTAL SHOTS', mises: 'HITS', attaque: 'TIME ON ATTACK', passes: 'PASSING',
  engagements: 'FACEOFFS WON', penalites: 'PENALTY MINUTES', avantages: 'POWERPLAYS',
  minAvantage: 'POWERPLAY MINUTES', inferiorite: 'SHORTHANDED GOALS',
};

async function lirePhotoResultat(env, photo, ctx) {
  if (!env.GEMINI_KEY) return json({ ok: false, erreur: 'lecture_indisponible' });
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.mime) || !photo.data) return json({ ok: false, erreur: 'photo' });
  const cote = (quel) => ({
    type: 'OBJECT',
    properties: Object.assign({
      code: { type: 'STRING', description: `3-letter abbreviation of the ${quel} team on the scoreboard (e.g. NYR)` },
      buts: { type: 'INTEGER', description: `final score of the ${quel} team (big number on the scoreboard)` },
    }, Object.fromEntries(Object.entries(STATS_RESULTAT).map(([k, v]) =>
      [k, { type: 'STRING', description: `${quel} column value of the row labelled "${v}"` }]))),
    required: ['code', 'buts', ...Object.keys(STATS_RESULTAT)],
  });
  const consigne = 'This image shows the end-of-game summary screen of EA Sports NHL. It may be a phone photo of a TV, '
    + 'or a screenshot of a stream or browser window with other things around it (chat, menus): only use the game screen. '
    + 'Read the team abbreviations and final score from the scoreboard (left team and right team). '
    + 'Below the scoreboard, each stat row has a small label in the middle, the left team value at the far left '
    + 'and the right team value at the far right. Copy each value exactly as displayed, digits and symbols only '
    + '(formats like "37", "10:59", "80.3%", "0 / 4"). Rows from top to bottom: '
    + Object.entries(STATS_RESULTAT).map(([k, v]) => `${k} = "${v}"`).join(', ') + '. '
    + 'For "fin", answer PROL if the screen shows the game ended in overtime (OT), TB if it ended in a shootout (SO), otherwise REG. '
    + 'Set "lisible" to false if this is not such a screen or it cannot be read; leave unreadable values empty.';
  const corps = {
    contents: [{ parts: [{ inline_data: { mime_type: photo.mime, data: photo.data } }, { text: consigne }] }],
    generationConfig: {
      temperature: 0,
      // Recopier des valeurs ne demande pas de « réflexion » : c'était l'essentiel du délai.
      thinkingConfig: { thinkingBudget: 0 },
      mediaResolution: 'MEDIA_RESOLUTION_HIGH',
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { lisible: { type: 'BOOLEAN' }, gauche: cote('left'), droite: cote('right'), fin: { type: 'STRING', enum: ['REG', 'PROL', 'TB'] } },
        required: ['lisible', 'gauche', 'droite', 'fin'],
      },
    },
  };
  // Modèle gratuit souvent surchargé le soir : surcharge (503) ou réponse trop lente →
  // on passe tout de suite au modèle de secours, plus léger, plutôt que d'attendre.
  const modeles = [
    { nom: env.GEMINI_MODEL || 'gemini-flash-latest', delai: 15000 },
    { nom: env.GEMINI_MODEL_SECOURS || 'gemini-flash-lite-latest', delai: 25000 },
  ];
  const debut = Date.now();
  const essais = [];   // historique : [modèle, durée, statut] de chaque appel
  const fin = (reponse, extra) => { noterLecture(env, ctx, { t: new Date(debut).toISOString(), match: String(photo.match || ''), ko: Math.round(photo.data.length * 0.75 / 1024), ms: Date.now() - debut, essais, ...extra }); return json(reponse); };
  let derniere = 'lecture';
  for (const { nom: modele, delai } of modeles) {
    const config = JSON.parse(JSON.stringify(corps.generationConfig));
    for (let essai = 0; essai < 3; essai++) {
      const t0 = Date.now();
      try {
        const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
          body: JSON.stringify({ ...corps, generationConfig: config }),
          signal: AbortSignal.timeout(delai),
        });
        if (!rep.ok) {
          const erreur = (await rep.text()).slice(0, 300);
          console.error('Gemini', modele, rep.status, (Date.now() - t0) + ' ms', erreur);
          essais.push([modele, Date.now() - t0, rep.status]);
          derniere = rep.status === 429 ? 'quota' : 'lecture';
          // Réglage refusé par ce modèle (haute définition, réflexion) : on réessaie sans.
          if (rep.status === 400 && config.mediaResolution) { delete config.mediaResolution; continue; }
          if (rep.status === 400 && config.thinkingConfig) { delete config.thinkingConfig; continue; }
          break;   // surcharge ou autre erreur : modèle suivant
        }
        const donnees = await rep.json();
        const texte = (donnees.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
        console.log('Gemini', modele, (Date.now() - t0) + ' ms (total ' + (Date.now() - debut) + ' ms)', texte.slice(0, 1500));
        essais.push([modele, Date.now() - t0, 200]);
        const lecture = nettoyerLecture(JSON.parse(texte));
        return fin({ ok: true, lecture, modele }, { ok: true, modele, lisible: lecture.lisible !== false });
      } catch (err) {
        console.error('Gemini', modele, (Date.now() - t0) + ' ms', err.name === 'TimeoutError' ? 'trop lent, modèle suivant' : err.message);
        essais.push([modele, Date.now() - t0, err.name === 'TimeoutError' ? 'lent' : 'erreur']);
        break;
      }
    }
  }
  return fin({ ok: false, erreur: derniere }, { ok: false, erreur: derniere });
}

// Historique des lectures (KV LECTURES, clé « historique ») : les 300 dernières, la plus
// récente en premier. Écrit après la réponse au DG, pour ne pas le faire attendre.
function noterLecture(env, ctx, entree) {
  if (!env.LECTURES || !ctx) return;
  ctx.waitUntil((async () => {
    try {
      const liste = (await env.LECTURES.get('historique', 'json')) || [];
      liste.unshift(entree);
      await env.LECTURES.put('historique', JSON.stringify(liste.slice(0, 300)));
    } catch (err) { console.error('Historique des lectures :', err.message); }
  })());
}

// Une stat ne contient que des chiffres et « : . % / » : le reste (ex. « 37 Lucas ») est vidé
// pour que le DG le remplisse lui-même plutôt que d'envoyer une valeur inventée.
function nettoyerLecture(l) {
  ['gauche', 'droite'].forEach(c => {
    const cote = l[c] || (l[c] = {});
    cote.code = String(cote.code || '').trim().toUpperCase().slice(0, 3);
    Object.keys(STATS_RESULTAT).forEach(k => {
      const v = String(cote[k] == null ? '' : cote[k]).trim();
      cote[k] = /^[\d\s:.,%/]{1,12}$/.test(v) ? v.replace(/\s+/g, ' ') : '';
    });
  });
  return l;
}

/* ---------- Enchères des agents libres ---------- */
// Le script vérifie tout (équipe, jetons, minimum, chrono) sous verrou ; le Worker
// publie ensuite l'annonce dans le canal Discord des agents libres.
async function actionEnchere(env, action, courriel, corps) {
  const r = await scriptJson(env, action, courriel, corps);
  if (r.ok && r.discord) {
    const envoi = await envoyerDiscord(env, r.discord.flux, r.discord.message);
    if (envoi.erreur) console.error('Discord (enchère) :', envoi.erreur);
    r.discord = !envoi.erreur;
  }
  return json(r, r.ok ? 200 : 400);
}

/* ---------- Transactions entre équipes ---------- */
// Le script vérifie tout sous verrou. Les offres restent privées : rien sur Discord ;
// seule la transaction approuvée y est publiée (route /api/transactions/decider).
async function actionTransaction(env, action, courriel, corps) {
  const r = await scriptJson(env, action, courriel, corps);
  return json(r, r.ok ? 200 : 400);
}

// Lecture rapide de l'onglet public ENCHERES : on n'appelle le script (plus lent)
// que s'il y a vraiment une enchère à fermer.
async function cloturerEncheres(env) {
  try {
    const rep = await fetch('https://docs.google.com/spreadsheets/d/1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A/gviz/tq?tqx=out:json&headers=1&sheet=ENCHERES');
    const m = (await rep.text()).match(/setResponse\(([\s\S]*)\);\s*$/);
    if (!m) return;
    const table = JSON.parse(m[1]).table;
    if (((table.cols[0] || {}).label || '') !== 'ID') return;
    const maintenant = Date.now();
    const echue = table.rows.some(r => {
      const c = r.c || [];
      const statut = c[10] && c[10].v, fin = c[9] && c[9].v;
      return statut === 'En cours' && fin && new Date(fin).getTime() <= maintenant;
    });
    // Tirage au sort programmé (colonne O) dont l'heure est arrivée.
    const tirageDu = table.rows.some(r => {
      const c = r.c || [];
      const statut = c[10] && c[10].v, prevu = c[14] && c[14].v;
      return statut === 'Tirage' && prevu && new Date(prevu).getTime() <= maintenant;
    });
    const actions = [echue && 'cloturerEncheres', tirageDu && 'tirerAuSortAuto'].filter(Boolean);
    for (const action of actions) {
      const r = await scriptJson(env, action, 'systeme');
      for (const msg of r.messages || []) {
        const envoi = await envoyerDiscord(env, msg.flux, msg.message);
        if (envoi.erreur) console.error('Discord (' + action + ') :', envoi.erreur);
      }
    }
  } catch (err) {
    console.error('Clôture des enchères :', err.message);
  }
}

// Le script enregistre la publication et prépare le message ; le Worker l'envoie
// à Discord (qui bloque souvent les adresses partagées de Google Apps Script).
// Une modification met à jour le message Discord existant (idDiscord) au lieu d'en publier un nouveau.
async function publier(env, action, courriel, corps) {
  const r = await scriptJson(env, action, courriel, corps);
  if (!r.ok || typeof r.discord !== 'object') return json(r, r.ok ? 200 : 400);
  const { flux, message, idDiscord } = r.discord;
  // Nouvelle image de couverture : déjà en main, inutile de la relire sur Drive.
  let couverture = null;
  try {
    const d = JSON.parse(corps);
    if (d.couverture && d.couverture.data) couverture = { octets: Uint8Array.from(atob(d.couverture.data), c => c.charCodeAt(0)), type: d.couverture.mime };
  } catch { /* corps déjà validé par le script */ }
  const envoi = await envoyerDiscord(env, flux, message, idDiscord, couverture);
  if (envoi.silencieux) return json({ ...r, discord: null }, 200);
  await scriptJson(env, 'discord', courriel, JSON.stringify({ flux, id: r.id, ...envoi }));
  return json({ ...r, discord: !envoi.erreur }, 200);
}

// Dirigeants : renvoie à Discord les publications qui n'y sont pas arrivées.
async function reessayerDiscord(env, courriel) {
  const r = await scriptJson(env, 'enAttente', courriel);
  if (!r.ok) return json(r, 400);
  const resultats = [];
  for (const p of r.attente) {
    const envoi = await envoyerDiscord(env, p.flux, p.message);
    await scriptJson(env, 'discord', courriel, JSON.stringify({ flux: p.flux, id: p.id, ...envoi }));
    resultats.push({ flux: p.flux, titre: p.titre, ok: !envoi.erreur, erreur: envoi.erreur });
  }
  return json({ ok: true, resultats }, 200);
}

// La bannière est jointe au message comme fichier : un lien Google Drive tout juste
// créé n'est pas encore lisible quelques secondes, et Discord garde alors une image vide.
async function envoyerDiscord(env, flux, message, idDiscord, couverture) {
  // « aucun » dans la colonne ID Discord : publication volontairement absente de Discord
  // (ex. ajoutée à la main dans le classeur) ; une modification ne doit pas l'y publier.
  if (idDiscord === 'aucun') return { silencieux: true };
  const webhook = env['WEBHOOK_' + flux];
  if (!webhook) return { erreur: 'Webhook ' + flux + ' manquant dans le Worker' };
  // Un message déjà publié se modifie sur place ; son nom et son avatar ne changent pas.
  const modif = /^\d+$/.test(idDiscord || '');
  const { username, avatar_url, ...contenu } = message;
  const charge = structuredClone(modif ? contenu : message);
  // Une modification remplace les fichiers joints (ou les retire s'il n'y a plus d'image).
  charge.attachments = [];

  const banniere = charge.embeds.find(e => e.image && !e.title);
  const image = banniere ? (couverture || await lireImage(banniere.image.url)) : null;
  const corps = new FormData();
  if (image) {
    const nom = 'banniere.' + (/png/.test(image.type) ? 'png' : /webp/.test(image.type) ? 'webp' : 'jpg');
    banniere.image.url = 'attachment://' + nom;
    charge.attachments = [{ id: 0, filename: nom }];
    corps.append('files[0]', new Blob([image.octets], { type: image.type || 'image/jpeg' }), nom);
  }
  corps.append('payload_json', JSON.stringify(charge));

  try {
    const rep = await fetch(modif ? `${webhook}/messages/${idDiscord}` : webhook + '?wait=true', {
      method: modif ? 'PATCH' : 'POST',
      body: corps,
    });
    // Message supprimé dans Discord entre-temps : on en publie un nouveau.
    if (modif && rep.status === 404) return envoyerDiscord(env, flux, message, '', couverture);
    const texte = await rep.text();
    if (!rep.ok) return { erreur: 'Discord a refusé (' + rep.status + ') : ' + texte.slice(0, 300) };
    return { idDiscord: JSON.parse(texte).id };
  } catch (err) {
    return { erreur: 'Discord injoignable : ' + err.message };
  }
}

// Image déjà sur Drive (couverture gardée, ou 1re image du texte) : quelques essais,
// le temps que Google la rende lisible. null si elle reste introuvable (le lien est gardé).
async function lireImage(url) {
  if (!/^https:\/\/lh3\.googleusercontent\.com\//.test(url)) return null;
  for (let essai = 0; essai < 5; essai++) {
    if (essai) await new Promise(r => setTimeout(r, 2000));
    try {
      const rep = await fetch(url);
      const type = rep.headers.get('Content-Type') || '';
      if (rep.ok && type.startsWith('image/')) return { octets: new Uint8Array(await rep.arrayBuffer()), type };
    } catch { /* nouvel essai */ }
  }
  return null;
}

/* ---------- Connexion Discord (dg.lnhq.ca) ----------
   /auth/discord/connexion → Discord (portée « identify » : identifiant et nom seulement)
   → /auth/discord (retour) → cookie de session signé (HMAC, SESSION_SECRET) de 30 jours.
   Les droits ne sont pas dans la session : chaque appel relit l'onglet ACCES du script,
   donc effacer l'ID Discord d'une ligne coupe l'accès tout de suite. */
async function authentification(request, env, url) {
  if (url.hostname !== HOTE_DG) return Response.redirect(`https://${HOTE_DG}${url.pathname}${url.search}`, 302);

  if (url.pathname === '/auth/discord/connexion') {
    const retour = adresseRetour(url.searchParams.get('retour'));
    const lier = url.searchParams.get('lier') || '';
    const etat = b64url(crypto.getRandomValues(new Uint8Array(18)));
    const cible = new URL('https://discord.com/oauth2/authorize');
    cible.searchParams.set('client_id', String(env.DISCORD_CLIENT_ID).trim());
    cible.searchParams.set('response_type', 'code');
    cible.searchParams.set('redirect_uri', RETOUR_DISCORD);
    cible.searchParams.set('scope', 'identify');
    cible.searchParams.set('state', etat);
    cible.searchParams.set('prompt', 'none');
    const cookie = await signer(env, { etat, retour, lier, exp: maintenant() + 600 });
    return redirection(cible.href, `${COOKIE_ETAT}=${cookie}; Path=/auth; Max-Age=600; Secure; HttpOnly; SameSite=Lax`);
  }

  if (url.pathname === '/auth/discord') {
    const etat = await verifierSigne(env, lireCookie(request, COOKIE_ETAT));
    const effacerEtat = `${COOKIE_ETAT}=; Path=/auth; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
    if (url.searchParams.get('error')) {
      return pageMessage('Connexion annulée', 'La connexion Discord a été annulée.', '/', 'Réessayer', effacerEtat);
    }
    if (!etat || etat.etat !== url.searchParams.get('state')) {
      return pageMessage('Connexion expirée', 'La demande de connexion a expiré. Recommence.', '/', 'Se connecter', effacerEtat);
    }
    let utilisateur;
    try {
      utilisateur = await utilisateurDiscord(env, url.searchParams.get('code') || '');
    } catch (err) {
      console.error('Discord OAuth :', err.message);
      return pageMessage('Discord ne répond pas', 'Impossible de vérifier ton compte Discord pour le moment. Réessaie dans un instant.', '/', 'Réessayer', effacerEtat);
    }

    let retour = etat.retour;
    if (etat.lier) {
      const courriel = /^[\w-]{24}$/.test(etat.lier) ? await env.LECTURES.get('lier:' + etat.lier) : null;
      if (!courriel) return pageMessage('Lien expiré', 'Le lien a expiré. Retourne sur publier.lnhq.ca/lier-discord.html et recommence.', 'https://publier.lnhq.ca/lier-discord.html', 'Recommencer', effacerEtat);
      await env.LECTURES.delete('lier:' + etat.lier);
      const r = await scriptJson(env, 'lierDiscord', courriel, JSON.stringify({ id: utilisateur.id, nom: utilisateur.nom }));
      if (!r.ok) {
        const textes = {
          deja_lie: 'Ton compte LNHQ est déjà lié à un autre compte Discord. Demande au commissaire de le délier.',
          id_pris: 'Ce compte Discord est déjà lié à un autre compte LNHQ. Demande au commissaire de vérifier.',
          inconnu: "Ton courriel n'est plus dans la liste d'accès de la ligue.",
        };
        return pageMessage('Lien impossible', textes[r.erreur] || 'Le lien n’a pas pu être enregistré. Réessaie plus tard.', 'https://publier.lnhq.ca/lier-discord.html', 'Retour', effacerEtat);
      }
      retour = '/lier-discord.html?lie=1';
    }

    const session = await signer(env, { id: utilisateur.id, nom: utilisateur.nom, exp: maintenant() + DUREE_SESSION });
    const rep = redirection(`https://${HOTE_DG}${retour}`, `${COOKIE_SESSION}=${session}; Path=/; Max-Age=${DUREE_SESSION}; Secure; HttpOnly; SameSite=Lax`);
    rep.headers.append('Set-Cookie', effacerEtat);
    return rep;
  }

  if (url.pathname === '/auth/deconnexion') {
    return redirection('https://lnhq.ca/', `${COOKIE_SESSION}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
  }
  return json({ ok: false, erreur: 'introuvable' }, 404);
}

async function utilisateurDiscord(env, code) {
  if (!code) throw new Error('code absent');
  const rep = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: String(env.DISCORD_CLIENT_ID).trim(),
      client_secret: String(env.DISCORD_CLIENT_SECRET).trim(),
      grant_type: 'authorization_code',
      code,
      redirect_uri: RETOUR_DISCORD,
    }),
  });
  const jeton = await rep.json().catch(() => ({}));
  if (!jeton.access_token) throw new Error(`jeton refusé (${rep.status}) ${JSON.stringify(jeton).slice(0, 200)}`);
  const u = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + jeton.access_token } })
    .then(r => r.json());
  if (!/^\d{15,22}$/.test(String(u.id || ''))) throw new Error('utilisateur sans identifiant');
  return { id: String(u.id), nom: String(u.global_name || u.username || '').slice(0, 64) };
}

async function lireSession(request, env) {
  const s = await verifierSigne(env, lireCookie(request, COOKIE_SESSION));
  return s && s.id ? s : null;
}

// Seulement un chemin de ce site (jamais une autre adresse).
function adresseRetour(retour) {
  return retour && retour.startsWith('/') && !retour.startsWith('//') && !retour.startsWith('/auth/') ? retour : '/';
}

function estPage(chemin) {
  return chemin.endsWith('.html') || !/\.[a-z0-9]+$/i.test(chemin);
}

function maintenant() {
  return Math.floor(Date.now() / 1000);
}

function lireCookie(request, nom) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + nom + '=([^;]+)'));
  return m ? m[1] : '';
}

function redirection(adresse, cookie) {
  return new Response(null, { status: 302, headers: { Location: adresse, 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } });
}

async function cleSession(env) {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET manquant');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signer(env, donnees) {
  const charge = b64url(new TextEncoder().encode(JSON.stringify(donnees)));
  const signature = await crypto.subtle.sign('HMAC', await cleSession(env), new TextEncoder().encode(charge));
  return charge + '.' + b64url(new Uint8Array(signature));
}

// Renvoie les données si la signature est bonne et la date d'expiration pas dépassée.
async function verifierSigne(env, jeton) {
  const [charge, signature] = String(jeton || '').split('.');
  if (!charge || !signature) return null;
  try {
    const valide = await crypto.subtle.verify('HMAC', await cleSession(env), octetsB64url(signature), new TextEncoder().encode(charge));
    if (!valide) return null;
    const donnees = JSON.parse(texteB64url(charge));
    return donnees.exp > maintenant() ? donnees : null;
  } catch {
    return null;
  }
}

function b64url(octets) {
  let binaire = '';
  for (const o of octets) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Page de connexion de dg.lnhq.ca : Discord, ou la même page sur publier.lnhq.ca (courriel,
// Cloudflare Access) pour ceux qui n'ont pas encore lié leur compte.
function pageConnexion(chemin) {
  const retour = adresseRetour(chemin);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const discord = '/auth/discord/connexion?retour=' + encodeURIComponent(retour);
  const courriel = 'https://publier.lnhq.ca' + retour;
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Connexion — LNHQ</title><link rel="icon" type="image/png" href="https://lnhq.ca/logo-lnhq.png">
<link rel="stylesheet" href="https://lnhq.ca/site.css?v=9"><link rel="stylesheet" href="/admin.css?v=5"></head><body><div class="app">
<header class="app-header"><div class="header-row"><a class="brand" href="https://lnhq.ca/"><img class="brand-logo" src="https://lnhq.ca/logo-lnhq.png" alt="LNHQ"><h1 class="app-title">LNHQ</h1></a></div>
<div class="meta-row"><span>Espace DG</span></div></header>
<main class="adm-page"><section class="adm-carte adm-etroite">
<h2 class="adm-titre">Connexion</h2>
<p>Connecte-toi avec ton compte Discord pour accéder à l'espace des DG.</p>
<a class="adm-bouton adm-discord" href="${esc(discord)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.6 19.6 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.8 19.8 0 0 0 6 3l1.3-2.1a12.8 12.8 0 0 1-2-1l.5-.4a14.1 14.1 0 0 0 12.2 0l.5.4a12.8 12.8 0 0 1-2 1l1.3 2.1a19.7 19.7 0 0 0 6-3c.5-5.2-.9-9.7-3.6-13.7ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>Se connecter avec Discord</a>
<a class="adm-bouton adm-secondaire" href="${esc(courriel)}">Continuer avec mon courriel</a>
<p class="adm-note">Ton compte n'est pas encore lié à Discord ? Le courriel fonctionne encore. Pour passer à Discord, lie ton compte une fois :
<a href="https://publier.lnhq.ca/lier-discord.html">lier mon compte Discord</a>.</p>
</section></main></div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function pageMessage(titre, texte, lien, libelle, cookie) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titre)} — LNHQ</title><link rel="icon" type="image/png" href="https://lnhq.ca/logo-lnhq.png">
<link rel="stylesheet" href="https://lnhq.ca/site.css?v=9"></head><body><div class="app"><main style="max-width:560px;margin:0 auto;padding:40px 16px">
<div class="status-box error"><div><strong>${esc(titre)}</strong><br>${esc(texte)}<br><br><a href="${esc(lien)}">${esc(libelle)}</a></div></div>
</main></div></body></html>`;
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(html, { status: 400, headers });
}

// Vérifie le jeton signé qu'Access ajoute à chaque requête autorisée, et renvoie le courriel.
async function verifierAcces(request, env) {
  const jeton = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jeton) throw new Error('jeton absent');
  const [enteteB64, chargeB64, signatureB64] = jeton.split('.');
  const entete = JSON.parse(texteB64url(enteteB64));
  const charge = JSON.parse(texteB64url(chargeB64));
  if (entete.alg !== 'RS256') throw new Error('algorithme inattendu');

  const certs = await fetch(env.ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs', { cf: { cacheTtl: 3600 } })
    .then(r => r.json());
  const jwk = (certs.keys || []).find(k => k.kid === entete.kid);
  if (!jwk) throw new Error('clé inconnue');
  const cle = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valide = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cle, octetsB64url(signatureB64),
    new TextEncoder().encode(enteteB64 + '.' + chargeB64));
  if (!valide) throw new Error('signature invalide');

  const audiences = Array.isArray(charge.aud) ? charge.aud : [charge.aud];
  if (!audiences.includes(env.ACCESS_AUD)) throw new Error('audience invalide');
  if (charge.iss !== env.ACCESS_TEAM_DOMAIN) throw new Error('émetteur invalide');
  if (!charge.exp || charge.exp * 1000 < Date.now()) throw new Error('jeton expiré');
  if (!charge.email) throw new Error('courriel absent');
  return String(charge.email).toLowerCase();
}

// Le corps est transmis sans être relu (photos incluses) ; action, courriel et secret
// passent dans l'adresse, construite ici : le navigateur ne peut pas les imposer.
async function appelerScript(env, action, courriel, corps) {
  const resultat = await scriptJson(env, action, courriel, corps);
  return json(resultat, resultat.ok ? 200 : resultat.erreur === 'script' ? 502 : 400);
}

async function scriptJson(env, action, courriel, corps) {
  const cible = new URL(env.SCRIPT_URL);
  cible.searchParams.set('action', action);
  cible.searchParams.set('courriel', courriel);
  cible.searchParams.set('secret', env.SCRIPT_SECRET);

  let rep = await fetch(cible, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: corps || '{}',
    redirect: 'manual',
  });
  // Apps Script répond par une redirection vers le résultat, à lire en GET.
  if (rep.status >= 300 && rep.status < 400) rep = await fetch(rep.headers.get('Location'));

  const texte = await rep.text();
  try {
    return JSON.parse(texte);
  } catch {
    console.error('Réponse inattendue du script :', rep.status, texte.slice(0, 300));
    return { ok: false, erreur: 'script' };
  }
}

function json(donnees, statut) {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function octetsB64url(s) {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function texteB64url(s) {
  return new TextDecoder().decode(octetsB64url(s));
}
