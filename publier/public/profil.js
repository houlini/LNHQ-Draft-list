/* LNHQ — fiche du DG (dg.lnhq.ca/profil.html) : nom, gamertag et Twitch de l'onglet
   « DGs » (page lnhq.ca/dgs.html). Discord reste géré par la ligue. Un admin peut
   choisir une autre équipe (?equipe=MTL). */
(function(){
  const $ = id => document.getElementById(id);
  const EQUIPES = {
    ANA: 'Anaheim', BOS: 'Boston', BUF: 'Buffalo', CGY: 'Calgary', CAR: 'Caroline', CHI: 'Chicago', COL: 'Colorado',
    CBJ: 'Columbus', DAL: 'Dallas', DET: 'Detroit', EDM: 'Edmonton', FLA: 'Floride', LAK: 'Los Angeles', MIN: 'Minnesota',
    MTL: 'Montréal', NSH: 'Nashville', NJD: 'New Jersey', NYI: 'NY Islanders', NYR: 'NY Rangers', OTT: 'Ottawa',
    PHI: 'Philadelphie', PIT: 'Pittsburgh', SJS: 'San Jose', SEA: 'Seattle', STL: 'St. Louis', TBL: 'Tampa Bay',
    TOR: 'Toronto', UTA: 'Utah', VAN: 'Vancouver', VGK: 'Vegas', WSH: 'Washington', WPG: 'Winnipeg',
  };
  const ERREURS = {
    acces: 'Ta session n’est plus valide. Recharge la page.',
    inconnu: "Ton compte n'est pas dans la liste d'accès de la ligue.",
    pas_ton_equipe: "Ton compte n'est lié à aucune équipe.",
    equipe: 'Choisis une équipe.',
    introuvable: "Cette équipe n'est pas dans l'onglet DGs du classeur.",
    nom: 'Le nom est obligatoire.',
    champ: 'Un champ est trop long ou commence par =, + ou -.',
    twitch: 'Nom de chaîne Twitch invalide (3 à 25 lettres, chiffres ou _).',
  };
  let code = '';
  let initial = '';

  function message(texte, ok){
    const m = $('message');
    m.textContent = texte;
    m.className = 'adm-etat ' + (ok ? 'is-ok' : 'is-erreur');
    m.hidden = false;
  }
  const valeurs = () => JSON.stringify([$('dg').value.trim(), $('gamertag').value.trim(), $('twitch').value.trim()]);

  async function json(chemin, options){
    try{ return await (await fetch(chemin, { cache: 'no-store', ...options })).json(); }
    catch(e){ return { ok: false, erreur: 'reseau' }; }
  }

  async function charger(c){
    const r = await json('/api/profil' + (c ? '?equipe=' + encodeURIComponent(c) : ''));
    if(!r.ok){
      if(!code){
        $('qui').textContent = '';
        $('refusTexte').textContent = ERREURS[r.erreur] || 'Fiche illisible pour le moment. Réessaie plus tard.';
        $('refus').hidden = false;
      }else message(ERREURS[r.erreur] || 'Fiche illisible pour le moment.', false);
      return r;
    }
    code = r.code;
    $('qui').textContent = 'Fiche de ' + (EQUIPES[code] || code) + (r.admin ? ' · admin' : '');
    $('logo').src = `https://lnhq.ca/Logos/${code}.png`;
    $('dg').value = r.dg;
    $('gamertag').value = r.gamertag;
    $('twitch').value = r.twitch;
    $('discord').textContent = r.discord || '—';
    initial = valeurs();
    $('message').hidden = true;
    return r;
  }

  async function demarrer(){
    const demande = (new URLSearchParams(location.search).get('equipe') || '').toUpperCase();
    let r = await charger(EQUIPES[demande] ? demande : '');
    // Admin sans équipe (compte « Ligue ») : première équipe de la liste.
    if(!r.ok && r.erreur === 'equipe') r = await charger('ANA');
    if(!r.ok) return;
    if(r.admin){
      const sel = $('equipe');
      sel.replaceChildren(...Object.keys(EQUIPES).sort((a, b) => EQUIPES[a].localeCompare(EQUIPES[b], 'fr'))
        .map(c => new Option(EQUIPES[c], c)));
      sel.value = code;
      sel.addEventListener('change', async () => {
        if(valeurs() !== initial && !confirm('Tes changements non enregistrés seront perdus. Continuer ?')){ sel.value = code; return; }
        await charger(sel.value);
      });
      $('champEquipe').hidden = false;
    }
    $('formulaire').hidden = false;
  }

  $('formulaire').addEventListener('submit', async e => {
    e.preventDefault();
    if(!$('dg').value.trim()){ message(ERREURS.nom, false); return; }
    $('enregistrer').disabled = true;
    const r = await json('/api/profil', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, dg: $('dg').value, gamertag: $('gamertag').value, twitch: $('twitch').value }) });
    $('enregistrer').disabled = false;
    if(!r.ok){ message(ERREURS[r.erreur] || "L'enregistrement a échoué. Réessaie.", false); return; }
    await charger(code);
    message('Fiche enregistrée. Elle apparaît sur la page DGs du site (quelques secondes peuvent être nécessaires).', true);
  });

  window.addEventListener('beforeunload', ev => { if(initial && valeurs() !== initial){ ev.preventDefault(); ev.returnValue = ''; } });
  demarrer();
})();
