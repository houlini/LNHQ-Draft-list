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
    if (url.pathname === '/api/publier' && request.method === 'POST') {
      const taille = Number(request.headers.get('Content-Length') || 0);
      if (!taille || taille > MAX_OCTETS_ENVOI) return json({ ok: false, erreur: 'taille' }, 413);
      return appelerScript(env, 'publier', courriel, request.body);
    }
    return json({ ok: false, erreur: 'introuvable' }, 404);
  },
};

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
    const resultat = JSON.parse(texte);
    return json(resultat, resultat.ok ? 200 : 400);
  } catch {
    console.error('Réponse inattendue du script :', rep.status, texte.slice(0, 300));
    return json({ ok: false, erreur: 'script' }, 502);
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
