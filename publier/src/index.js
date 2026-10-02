// LNHQ — Worker de publier.lnhq.ca : sert l'éditeur (dossier public/) et relaie
// les envois vers l'application web Apps Script, avec le courriel vérifié par Access.

const MAX_OCTETS_ENVOI = 20 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    let courriel;
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

    if (url.pathname === '/api/moi' && request.method === 'GET') {
      return appelerScript(env, 'moi', courriel);
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
    const gardien = { '/api/gardien/declarer': 'declarerGardien', '/api/gardien/retirer': 'retirerGardien' }[url.pathname];
    if (gardien && request.method === 'POST') {
      return appelerScript(env, gardien, courriel, await request.text());
    }
    const resultat = { '/api/resultat/lire': 'lire', '/api/resultat/soumettre': 'soumettreResultat' }[url.pathname];
    if (resultat && request.method === 'POST') {
      const taille = Number(request.headers.get('Content-Length') || 0);
      if (!taille || taille > MAX_OCTETS_ENVOI) return json({ ok: false, erreur: 'taille' }, 413);
      if (resultat === 'lire') return lirePhotoResultat(env, await request.json().catch(() => ({})));
      return appelerScript(env, resultat, courriel, await request.text());
    }
    const enchere = { '/api/encheres/lancer': 'lancerEnchere', '/api/encheres/miser': 'miserEnchere' }[url.pathname];
    if (enchere && request.method === 'POST') {
      return actionEnchere(env, enchere, courriel, await request.text());
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

async function lirePhotoResultat(env, photo) {
  if (!env.GEMINI_KEY) return json({ ok: false, erreur: 'lecture_indisponible' });
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.mime) || !photo.data) return json({ ok: false, erreur: 'photo' });
  const cote = {
    type: 'OBJECT',
    properties: Object.assign({ code: { type: 'STRING' }, buts: { type: 'INTEGER' } },
      Object.fromEntries(Object.keys(STATS_RESULTAT).map(k => [k, { type: 'STRING' }]))),
    required: ['code', 'buts'],
  };
  const consigne = 'This is a photo of the end-of-game summary screen of EA Sports NHL. '
    + 'Read the team abbreviations and final score from the scoreboard (left team and right team), '
    + 'then each stat row for the left and right team, exactly as displayed '
    + '(keep formats like "10:59", "80.3%", "0 / 4"). Rows: '
    + Object.entries(STATS_RESULTAT).map(([k, v]) => `${k} = "${v}"`).join(', ') + '. '
    + 'For "fin", answer PROL if the screen shows the game ended in overtime (OT), TB if it ended in a shootout (SO), otherwise REG. '
    + 'Set "lisible" to false if this is not such a screen or it cannot be read; leave unreadable values empty.';
  const corps = {
    contents: [{ parts: [{ inline_data: { mime_type: photo.mime, data: photo.data } }, { text: consigne }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { lisible: { type: 'BOOLEAN' }, gauche: cote, droite: cote, fin: { type: 'STRING', enum: ['REG', 'PROL', 'TB'] } },
        required: ['lisible', 'gauche', 'droite', 'fin'],
      },
    },
  };
  const modele = env.GEMINI_MODEL || 'gemini-flash-latest';
  try {
    const rep = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
      body: JSON.stringify(corps),
    });
    if (!rep.ok) {
      console.error('Gemini', rep.status, (await rep.text()).slice(0, 500));
      return json({ ok: false, erreur: rep.status === 429 ? 'quota' : 'lecture' });
    }
    const donnees = await rep.json();
    const texte = (donnees.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    const lecture = JSON.parse(texte);
    return json({ ok: true, lecture });
  } catch (err) {
    console.error('Gemini :', err.message);
    return json({ ok: false, erreur: 'lecture' });
  }
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
    if (!echue) return;
    const r = await scriptJson(env, 'cloturerEncheres', 'systeme');
    for (const msg of r.messages || []) {
      const envoi = await envoyerDiscord(env, msg.flux, msg.message);
      if (envoi.erreur) console.error('Discord (fin d\'enchère) :', envoi.erreur);
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
