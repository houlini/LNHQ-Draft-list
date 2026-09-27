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
      return json({ ok: false, erreur: 'acces' }, 403);
    }

    if (url.pathname === '/api/moi' && request.method === 'GET') {
      return appelerScript(env, 'moi', courriel);
    }
    if (url.pathname === '/api/article' && request.method === 'GET') {
      return appelerScript(env, 'lire', courriel, JSON.stringify({ id: url.searchParams.get('id') || '' }));
    }
    if (url.pathname === '/api/reessayer' && request.method === 'POST') {
      return reessayerDiscord(env, courriel);
    }
    const action = { '/api/publier': 'publier', '/api/modifier': 'modifier', '/api/photo': 'photo' }[url.pathname];
    if (action && request.method === 'POST') {
      const taille = Number(request.headers.get('Content-Length') || 0);
      if (!taille || taille > MAX_OCTETS_ENVOI) return json({ ok: false, erreur: 'taille' }, 413);
      if (action === 'photo') return appelerScript(env, action, courriel, request.body);
      return publier(env, action, courriel, request.body);
    }
    return json({ ok: false, erreur: 'introuvable' }, 404);
  },
};

// Le script enregistre la publication et prépare le message ; le Worker l'envoie
// à Discord (qui bloque souvent les adresses partagées de Google Apps Script).
// Une modification met à jour le message Discord existant (idDiscord) au lieu d'en publier un nouveau.
async function publier(env, action, courriel, corps) {
  const r = await scriptJson(env, action, courriel, corps);
  if (!r.ok || typeof r.discord !== 'object') return json(r, r.ok ? 200 : 400);
  const { flux, message, idDiscord } = r.discord;
  const envoi = await envoyerDiscord(env, flux, message, idDiscord);
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

async function envoyerDiscord(env, flux, message, idDiscord) {
  const webhook = env['WEBHOOK_' + flux];
  if (!webhook) return { erreur: 'Webhook ' + flux + ' manquant dans le Worker' };
  // Un message déjà publié se modifie sur place ; son nom et son avatar ne changent pas.
  const modif = /^\d+$/.test(idDiscord || '');
  const { username, avatar_url, ...contenu } = message;
  try {
    const rep = await fetch(modif ? `${webhook}/messages/${idDiscord}` : webhook + '?wait=true', {
      method: modif ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(modif ? contenu : message),
    });
    // Message supprimé dans Discord entre-temps : on en publie un nouveau.
    if (modif && rep.status === 404) return envoyerDiscord(env, flux, message, '');
    const texte = await rep.text();
    if (!rep.ok) return { erreur: 'Discord a refusé (' + rep.status + ') : ' + texte.slice(0, 300) };
    return { idDiscord: JSON.parse(texte).id };
  } catch (err) {
    return { erreur: 'Discord injoignable : ' + err.message };
  }
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
