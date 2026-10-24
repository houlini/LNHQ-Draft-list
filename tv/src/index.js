// Worker de api.lnhq.ca (API publique du site) : LNHQ TV (/twitch) et inscriptions (/inscription).
// LNHQ TV — GET /twitch : les chaînes Twitch des DG (colonne
// TWITCH de l'onglet DGs du classeur) et, pour chacune, si elle est en direct avec le
// tag LNHQ. Les clés Twitch restent ici (secrets) ; la réponse est gardée 30 s en cache
// pour ne pas interroger Twitch à chaque visiteur.

const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';
const ONGLET = 'DGs';
const TAG = 'lnhq';
const DUREE_CACHE = 30;
const ORIGINES = ['https://lnhq.ca', 'https://www.lnhq.ca'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origine = request.headers.get('Origin') || '';
    // Le site en local (http://localhost:…) peut aussi lire l'API, pour les tests.
    const cors = {
      'Access-Control-Allow-Origin': ORIGINES.includes(origine) || /^http:\/\/localhost(:\d+)?$/.test(origine) ? origine : ORIGINES[0],
      'Vary': 'Origin',
    };
    if (url.pathname.startsWith('/inscription')) {
      return inscription(request, env, url, cors);
    }
    if (url.pathname === '/ratings-apercu' && request.method === 'GET') {
      return apercuRatings(env, ctx, cors);
    }
    if (url.pathname === '/ratings-equipes' && request.method === 'GET') {
      return ratingsEquipes(env, ctx, cors);
    }
    if (url.pathname !== '/twitch' || request.method !== 'GET') {
      return new Response('Introuvable', { status: 404, headers: cors });
    }

    // Copie partagée de 30 s. Son âge est vérifié ici (en-tête X-Genere) : les réglages
    // de cache de la zone Cloudflare peuvent allonger la durée annoncée à 4 h.
    const cache = caches.default;
    const cle = new Request('https://api.lnhq.ca/twitch?cache');
    let rep = await cache.match(cle);
    if (rep && !(Date.now() - Number(rep.headers.get('X-Genere') || 0) < DUREE_CACHE * 1000)) rep = null;
    if (!rep) {
      rep = await construire(env);
      if (rep.ok) ctx.waitUntil(cache.put(cle, rep.clone()));
    }
    const finale = new Response(rep.body, rep);
    Object.entries(cors).forEach(([k, v]) => finale.headers.set(k, v));
    // Le navigateur ne garde rien : un direct terminé disparaît au prochain appel.
    finale.headers.set('Cache-Control', 'no-store');
    return finale;
  },

  // Chaque minute (wrangler.toml → crons) : annonce les nouveaux directs sur Discord.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(annoncerDirects(env));
  },
};

/* ---------- Aperçu public des ratings NHL 27 (carte au survol du site) ---------- */
// La base complète reste privée (publier.lnhq.ca/ratings.html, derrière Access) : on ne
// publie que la moyenne de chaque groupe d'attributs, arrondie. Copie partagée d'une heure.
const GROUPES_RATINGS = {
  P: [['Acceleration', 'Agility', 'Balance', 'Endurance', 'Speed'],
    ['Slap Shot Accuracy', 'Slap Shot Power', 'Wrist Shot Accuracy', 'Wrist Shot Power'],
    ['Deking', 'Hand-Eye', 'Passing', 'Puck Control'],
    ['Def. Awareness', 'Faceoffs', 'Shot Blocking', 'Stick Checking'],
    ['Aggressiveness', 'Body Checking', 'Durability', 'Fighting Skill', 'Strength'],
    ['Discipline', 'Off. Awareness', 'Poise']],
  G: [['Angles', 'Breakaway', 'Five Hole', 'Glove High', 'Glove Low', 'Stick High', 'Stick Low'],
    ['Rebound Control', 'Recover', 'Vision', 'Poise', 'Poke Check', 'Passing', 'Puck Playing Freq.'],
    ['Aggressiveness', 'Agility', 'Durability', 'Endurance', 'Speed']],
};
const CODES_RATINGS = {
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

async function apercuRatings(env, ctx, cors) {
  const entetes = { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' };
  const cle = new Request('https://api.lnhq.ca/ratings-apercu?cache');
  const enCache = await caches.default.match(cle);
  if (enCache && Date.now() - Number(enCache.headers.get('X-Genere') || 0) < 3600 * 1000) {
    return new Response(enCache.body, { headers: entetes });
  }
  const base = env.RATINGS ? await env.RATINGS.get('joueurs', 'json') : null;
  if (!base) return new Response('{"ok":false,"erreur":"vide"}', { status: 503, headers: { ...entetes, 'Cache-Control': 'no-store' } });
  // [nom, prénom, code d'équipe, 'P' ou 'G', [notes par groupe]] — aucun attribut détaillé.
  const joueurs = Object.values(base).map(j => {
    const type = j.position === 'G' ? 'G' : 'P';
    const notes = GROUPES_RATINGS[type].map(g => {
      const v = g.map(k => j.attributs?.[k]).filter(x => typeof x === 'number');
      return v.length === g.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
    });
    return notes.some(n => n != null) ? [j.nom || '', j.prenom || '', CODES_RATINGS[(j.equipe || '').toLowerCase()] || '', type, notes] : null;
  }).filter(Boolean);
  const corps = JSON.stringify({ ok: true, joueurs });
  ctx.waitUntil(caches.default.put(cle, new Response(corps, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600', 'X-Genere': String(Date.now()) } })));
  return new Response(corps, { headers: entetes });
}

// Moyennes d'overall par équipe et par position (page Stats d'équipe) : seulement des
// moyennes d'équipe et le nombre de joueurs, aucune note individuelle.
// Position = la première listée (« C/LW » compte comme centre) ; LD/RD → D.
async function ratingsEquipes(env, ctx, cors) {
  const entetes = { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' };
  const cle = new Request('https://api.lnhq.ca/ratings-equipes?cache2');
  const enCache = await caches.default.match(cle);
  if (enCache && Date.now() - Number(enCache.headers.get('X-Genere') || 0) < 3600 * 1000) {
    return new Response(enCache.body, { headers: entetes });
  }
  const base = env.RATINGS ? await env.RATINGS.get('joueurs', 'json') : null;
  if (!base) return new Response('{"ok":false,"erreur":"vide"}', { status: 503, headers: { ...entetes, 'Cache-Control': 'no-store' } });
  const sommes = {}, groupes = {};
  const ajouter = (o, k, v) => { const s = o[k] || (o[k] = [0, 0]); s[0] += v; s[1]++; };
  Object.values(base).forEach(j => {
    const code = CODES_RATINGS[(j.equipe || '').toLowerCase()];
    if (!code || typeof j.overall !== 'number') return;
    const p = String(j.position || '').split('/')[0].trim().toUpperCase();
    const po = p === 'LD' || p === 'RD' ? 'D' : p;
    if (!['C', 'LW', 'RW', 'D', 'G'].includes(po)) return;
    const e = sommes[code] || (sommes[code] = {});
    [po, 'TOUS', ...(['C', 'LW', 'RW'].includes(po) ? ['ATT'] : [])].forEach(k => ajouter(e, k, j.overall));
    // Notes par groupe (patineurs : 6 groupes, gardiens : 3), moyenne des joueurs de l'équipe.
    const type = po === 'G' ? 'G' : 'P', g = groupes[code] || (groupes[code] = {});
    GROUPES_RATINGS[type].forEach((attrs, i) => {
      const v = attrs.map(k => j.attributs?.[k]).filter(x => typeof x === 'number');
      if (v.length === attrs.length) ajouter(g, type + i, v.reduce((s, x) => s + x, 0) / v.length);
    });
  });
  const moy = ([s, n]) => Math.round(s / n * 10) / 10;
  // { CODE: { C: [moyenne, nombre], LW, RW, D, G, ATT, TOUS, groupes: { P: [6 moyennes], G: [3] } } }.
  const equipes = Object.fromEntries(Object.entries(sommes).map(([code, e]) => {
    const r = Object.fromEntries(Object.entries(e).map(([k, s]) => [k, [moy(s), s[1]]]));
    const g = groupes[code] || {};
    r.groupes = { P: GROUPES_RATINGS.P.map((_, i) => g['P' + i] ? moy(g['P' + i]) : null), G: GROUPES_RATINGS.G.map((_, i) => g['G' + i] ? moy(g['G' + i]) : null) };
    return [code, r];
  }));
  const corps = JSON.stringify({ ok: true, equipes });
  ctx.waitUntil(caches.default.put(cle, new Response(corps, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600', 'X-Genere': String(Date.now()) } })));
  return new Response(corps, { headers: entetes });
}

/* ---------- Inscriptions (lnhq.ca/inscription.html) ---------- */
// Page publique : le Worker transmet au script (adresse et clé gardées en secrets,
// mêmes valeurs que pour publier.lnhq.ca). Le script n'accepte ici que ces 3 actions.
const ROUTES_INSCRIPTION = {
  'POST /inscription': 'inscrire',
  'POST /inscription/statut': 'statutInscription',
  'GET /inscription/equipes': 'equipesInscrites',
};

async function inscription(request, env, url, cors) {
  const entetes = { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
  }
  const action = ROUTES_INSCRIPTION[request.method + ' ' + url.pathname];
  if (!action) return new Response(JSON.stringify({ ok: false, erreur: 'introuvable' }), { status: 404, headers: entetes });
  if (!env.SCRIPT_URL || !env.SCRIPT_SECRET) return new Response(JSON.stringify({ ok: false, erreur: 'config' }), { status: 503, headers: entetes });

  let corps = '{}';
  if (request.method === 'POST') {
    const texte = await request.text();
    if (texte.length > 2000) return new Response(JSON.stringify({ ok: false, erreur: 'taille' }), { status: 413, headers: entetes });
    let d;
    try { d = JSON.parse(texte); } catch { d = {}; }
    // Piège à robots : champ invisible que seul un robot remplit. On répond « reçu » sans rien enregistrer.
    if (d.site) return new Response(JSON.stringify({ ok: true, statut: 'attente' }), { headers: entetes });
    corps = JSON.stringify({ courriel: d.courriel, equipe: d.equipe });
  }
  const cible = new URL(env.SCRIPT_URL);
  cible.searchParams.set('action', action);
  cible.searchParams.set('courriel', 'inscription');
  cible.searchParams.set('secret', env.SCRIPT_SECRET);
  try {
    let rep = await fetch(cible, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps, redirect: 'manual' });
    if (rep.status >= 300 && rep.status < 400) rep = await fetch(rep.headers.get('Location'));
    const r = JSON.parse(await rep.text());
    return new Response(JSON.stringify(r), { status: r.ok ? 200 : 400, headers: entetes });
  } catch (err) {
    console.error('Inscription :', err.message);
    return new Response(JSON.stringify({ ok: false, erreur: 'script' }), { status: 502, headers: entetes });
  }
}

async function construire(env) {
  const e = await etat(env);
  if (e.erreur === 'classeur') return json({ ok: false, erreur: 'classeur' }, 502);
  if (!e.ok) return json({ ok: false, erreur: e.erreur, chaines: e.chaines }, 200, 0);
  return json({ ok: true, maj: new Date().toISOString(), chaines: e.chaines });
}

// Chaînes du classeur et, pour chacune, l'état de son direct sur Twitch.
async function etat(env) {
  let chaines;
  try {
    chaines = await lireChaines();
  } catch (err) {
    console.error('Classeur illisible :', err.message);
    return { ok: false, erreur: 'classeur' };
  }
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    return { ok: false, erreur: 'config', chaines };
  }
  try {
    const enDirect = await streams(env, chaines.map(c => c.chaine));
    chaines.forEach(c => {
      const s = enDirect.get(c.chaine);
      if (!s) return;
      const tags = (s.tags || []).map(t => t.toLowerCase());
      c.live = true;
      // Tag Twitch « LNHQ », ou le mot LNHQ dans le titre, avec ou sans « # » : la
      // diffusion PlayStation n'a pas de tags et retire les « # » du titre.
      c.lnhq = tags.includes(TAG) || new RegExp('(^|[^a-z0-9])' + TAG + '($|[^a-z0-9])', 'i').test(s.title || '');
      c.nom = s.user_name;
      c.titre = s.title;
      c.jeu = s.game_name;
      c.spectateurs = s.viewer_count;
      c.debut = s.started_at;
      c.vignette = (s.thumbnail_url || '').replace('{width}', '640').replace('{height}', '360');
      c.stream = s.id;
    });
  } catch (err) {
    console.error('Twitch :', err.message);
    return { ok: false, erreur: 'twitch', chaines };
  }
  return { ok: true, chaines };
}

/* ---------- Annonces Discord des nouveaux directs (canal LNHQ TV) ---------- */
// Mémoire (KV « annonces ») : { chaine: { stream, t, fin } }. Un direct est annoncé
// une seule fois ; un direct relancé moins de 30 min après la fin du précédent
// (coupure, jeu qui plante) n'est pas réannoncé. On n'écrit en mémoire qu'aux
// changements (début, fin), pour rester loin de la limite gratuite d'écritures.
const DELAI_REANNONCE = 30 * 60 * 1000;

async function annoncerDirects(env) {
  if (!env.WEBHOOK_TV) return;
  const e = await etat(env);
  if (!e.ok) return;
  const maintenant = Date.now();
  const live = e.chaines.filter(x => x.live && x.lnhq);
  const enDirect = new Set(live.map(c => c.chaine));
  const avant = (await env.TV_ETAT.get('annonces', 'json')) || {};
  const apres = {};
  // Directs terminés : on note l'heure de fin, puis on les oublie après 30 min.
  Object.entries(avant).forEach(([chaine, a]) => {
    if (enDirect.has(chaine)) return;
    if (!a.fin) apres[chaine] = { ...a, fin: maintenant };
    else if (maintenant - a.fin < DELAI_REANNONCE) apres[chaine] = a;
  });

  for (const c of live) {
    const deja = avant[c.chaine];
    if (deja && (deja.stream === c.stream || (deja.fin && maintenant - deja.fin < DELAI_REANNONCE))) {
      apres[c.chaine] = { stream: c.stream, t: deja.t };
      continue;
    }
    // Échec d'envoi : rien n'est noté, on réessaie à la minute suivante.
    if (await annoncer(env, c)) apres[c.chaine] = { stream: c.stream, t: maintenant };
  }
  if (JSON.stringify(apres) !== JSON.stringify(avant)) await env.TV_ETAT.put('annonces', JSON.stringify(apres));
}

async function annoncer(env, c) {
  const page = 'https://lnhq.ca/tv.html?chaine=' + encodeURIComponent(c.chaine);
  const logo = c.code ? 'https://lnhq.ca/Logos/' + c.code + '.png' : 'https://lnhq.ca/logo-lnhq.png';
  const nom = c.nom || c.chaine;
  const message = {
    username: 'LNHQ TV',
    avatar_url: 'https://lnhq.ca/logo-lnhq.png',
    embeds: [{
      title: '🔴 ' + (c.titre || nom + ' est en direct'),
      url: page,
      description: `**${nom}**${c.equipe ? ' (' + c.equipe + ')' : ''} est en direct sur Twitch${c.jeu ? ' — ' + c.jeu : ''}.\n`
        + `[Regarder sur LNHQ TV](${page}) · [Ouvrir sur Twitch](https://www.twitch.tv/${c.chaine})`,
      color: 0x9146FF,
      thumbnail: { url: logo },
      // Paramètre ajouté : Discord garderait sinon une ancienne image de la chaîne.
      image: c.vignette ? { url: c.vignette + '?t=' + Date.now() } : undefined,
      timestamp: c.debut,
    }],
    allowed_mentions: { parse: [] },
  };
  try {
    const rep = await fetch(env.WEBHOOK_TV, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
    if (!rep.ok) console.error('Discord (LNHQ TV) :', rep.status, (await rep.text()).slice(0, 300));
    return rep.ok;
  } catch (err) {
    console.error('Discord (LNHQ TV) :', err.message);
    return false;
  }
}

// Onglet DGs : B Équipe, C Code, E DG, et la colonne dont l'en-tête est « TWITCH ».
async function lireChaines() {
  const rep = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=1&sheet=${ONGLET}`);
  const texte = await rep.text();
  const m = texte.match(/setResponse\(([\s\S]*)\);\s*$/);
  if (!m) throw new Error('format inattendu');
  const table = JSON.parse(m[1]).table;
  const labels = table.cols.map(c => (c.label || '').trim().toUpperCase());
  if (labels[1] !== 'ÉQUIPE') throw new Error('onglet DGs introuvable');
  const col = labels.indexOf('TWITCH');
  if (col < 0) return [];
  const vues = new Set();
  return table.rows.map(r => {
    const c = r.c || [];
    const str = i => (c[i] && c[i].v != null ? String(c[i].v).trim() : '');
    return { chaine: nomChaine(str(col)), equipe: str(1), code: str(2).toUpperCase(), dg: str(4), live: false, lnhq: false };
  }).filter(x => x.chaine && !vues.has(x.chaine) && vues.add(x.chaine));
}

// Accepte « nom », « @nom » ou une adresse twitch.tv/nom.
function nomChaine(valeur) {
  const m = /(?:twitch\.tv\/)?@?([a-z0-9_]{3,25})\/?$/i.exec(valeur.replace(/^https?:\/\/(www\.)?/i, ''));
  return m ? m[1].toLowerCase() : '';
}

async function streams(env, logins, reessai = false) {
  const resultat = new Map();
  if (!logins.length) return resultat;
  const jeton = await jetonTwitch(env);
  // L'API accepte jusqu'à 100 chaînes par appel.
  for (let i = 0; i < logins.length; i += 100) {
    const params = new URLSearchParams();
    logins.slice(i, i + 100).forEach(l => params.append('user_login', l));
    params.set('first', '100');
    const rep = await fetch('https://api.twitch.tv/helix/streams?' + params, {
      headers: { 'Client-Id': env.TWITCH_CLIENT_ID.trim(), 'Authorization': 'Bearer ' + jeton },
    });
    // Jeton invalidé par Twitch avant son échéance : on l'oublie (mémoire ET cache, sinon
    // il serait réutilisé jusqu'à 60 jours) et on en redemande un, une seule fois.
    if (rep.status === 401) {
      jetonMemoire = null;
      await caches.default.delete(CLE_JETON);
      if (!reessai) return streams(env, logins, true);
      throw new Error('jeton refusé (même après renouvellement : vérifier TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET)');
    }
    if (!rep.ok) throw new Error('HTTP ' + rep.status);
    (await rep.json()).data.forEach(s => resultat.set(s.user_login.toLowerCase(), s));
  }
  return resultat;
}

// Jeton d'application Twitch (valide ~60 jours), gardé en mémoire et dans le cache.
const CLE_JETON = new Request('https://api.lnhq.ca/twitch?jeton');
let jetonMemoire = null;
async function jetonTwitch(env) {
  if (jetonMemoire && jetonMemoire.expire > Date.now()) return jetonMemoire.valeur;
  const cle = CLE_JETON;
  const enCache = await caches.default.match(cle);
  if (enCache) {
    jetonMemoire = await enCache.json();
    if (jetonMemoire.expire > Date.now()) return jetonMemoire.valeur;
  }
  const rep = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID.trim(), client_secret: env.TWITCH_CLIENT_SECRET.trim(), grant_type: 'client_credentials' }),
  });
  // 403 « invalid client secret » : secret régénéré sur dev.twitch.tv → refaire wrangler secret put.
  if (!rep.ok) throw new Error('jeton Twitch HTTP ' + rep.status + ' ' + (await rep.text()).slice(0, 200));
  const d = await rep.json();
  const duree = Math.max(60, d.expires_in - 3600);
  jetonMemoire = { valeur: d.access_token, expire: Date.now() + duree * 1000 };
  await caches.default.put(cle, new Response(JSON.stringify(jetonMemoire), { headers: { 'Cache-Control': 'max-age=' + duree } }));
  return jetonMemoire.valeur;
}

function json(donnees, statut = 200, cache = DUREE_CACHE) {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache ? 'public, max-age=' + cache : 'no-store',
      'X-Genere': String(Date.now()),
    },
  });
}
