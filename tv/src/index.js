// LNHQ TV — Worker de api.lnhq.ca. GET /twitch : les chaînes Twitch des DG (colonne
// TWITCH de l'onglet DGs du classeur) et, pour chacune, si elle est en direct avec le
// tag LNHQ. Les clés Twitch restent ici (secrets) ; la réponse est gardée 60 s en cache
// pour ne pas interroger Twitch à chaque visiteur.

const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';
const ONGLET = 'DGs';
const TAG = 'lnhq';
const DUREE_CACHE = 60;
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
    if (url.pathname !== '/twitch' || request.method !== 'GET') {
      return new Response('Introuvable', { status: 404, headers: cors });
    }

    const cache = caches.default;
    const cle = new Request('https://api.lnhq.ca/twitch?cache');
    let rep = await cache.match(cle);
    if (!rep) {
      rep = await construire(env);
      if (rep.ok) ctx.waitUntil(cache.put(cle, rep.clone()));
    }
    const finale = new Response(rep.body, rep);
    Object.entries(cors).forEach(([k, v]) => finale.headers.set(k, v));
    return finale;
  },
};

async function construire(env) {
  let chaines;
  try {
    chaines = await lireChaines();
  } catch (err) {
    console.error('Classeur illisible :', err.message);
    return json({ ok: false, erreur: 'classeur' }, 502);
  }
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    return json({ ok: false, erreur: 'config', chaines }, 200, 0);
  }
  try {
    const enDirect = await streams(env, chaines.map(c => c.chaine));
    chaines.forEach(c => {
      const s = enDirect.get(c.chaine);
      if (!s) return;
      const tags = (s.tags || []).map(t => t.toLowerCase());
      c.live = true;
      // Tag Twitch « LNHQ », ou « #LNHQ » dans le titre du direct.
      c.lnhq = tags.includes(TAG) || new RegExp('#' + TAG + '\\b', 'i').test(s.title || '');
      c.nom = s.user_name;
      c.titre = s.title;
      c.jeu = s.game_name;
      c.spectateurs = s.viewer_count;
      c.debut = s.started_at;
      c.vignette = (s.thumbnail_url || '').replace('{width}', '640').replace('{height}', '360');
    });
  } catch (err) {
    console.error('Twitch :', err.message);
    return json({ ok: false, erreur: 'twitch', chaines }, 200, 0);
  }
  return json({ ok: true, maj: new Date().toISOString(), chaines });
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

async function streams(env, logins) {
  const resultat = new Map();
  if (!logins.length) return resultat;
  const jeton = await jetonTwitch(env);
  // L'API accepte jusqu'à 100 chaînes par appel.
  for (let i = 0; i < logins.length; i += 100) {
    const params = new URLSearchParams();
    logins.slice(i, i + 100).forEach(l => params.append('user_login', l));
    params.set('first', '100');
    const rep = await fetch('https://api.twitch.tv/helix/streams?' + params, {
      headers: { 'Client-Id': env.TWITCH_CLIENT_ID, 'Authorization': 'Bearer ' + jeton },
    });
    if (rep.status === 401) { jetonMemoire = null; throw new Error('jeton refusé'); }
    if (!rep.ok) throw new Error('HTTP ' + rep.status);
    (await rep.json()).data.forEach(s => resultat.set(s.user_login.toLowerCase(), s));
  }
  return resultat;
}

// Jeton d'application Twitch (valide ~60 jours), gardé en mémoire et dans le cache.
let jetonMemoire = null;
async function jetonTwitch(env) {
  if (jetonMemoire && jetonMemoire.expire > Date.now()) return jetonMemoire.valeur;
  const cle = new Request('https://api.lnhq.ca/twitch?jeton');
  const enCache = await caches.default.match(cle);
  if (enCache) {
    jetonMemoire = await enCache.json();
    if (jetonMemoire.expire > Date.now()) return jetonMemoire.valeur;
  }
  const rep = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, client_secret: env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' }),
  });
  if (!rep.ok) throw new Error('jeton Twitch HTTP ' + rep.status);
  const d = await rep.json();
  const duree = Math.max(60, d.expires_in - 3600);
  jetonMemoire = { valeur: d.access_token, expire: Date.now() + duree * 1000 };
  await caches.default.put(cle, new Response(JSON.stringify(jetonMemoire), { headers: { 'Cache-Control': 'max-age=' + duree } }));
  return jetonMemoire.valeur;
}

function json(donnees, statut = 200, cache = DUREE_CACHE) {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + cache },
  });
}
