/* LNHQ — page de mise des enchères (publier.lnhq.ca/encheres.html, derrière Cloudflare
   Access). L'équipe vient de la liste d'accès (/api/moi) ; le script revérifie tout
   sous verrou (jetons, minimum, chrono), cette page ne fait qu'aider à bien miser. */
(function(){
  const $ = id => document.getElementById(id);
  const E = window.LNHQ_ENCHERES;
  const CODES = {
    'Anaheim': 'ANA', 'Boston': 'BOS', 'Buffalo': 'BUF', 'Calgary': 'CGY', 'Caroline': 'CAR', 'Chicago': 'CHI',
    'Colorado': 'COL', 'Columbus': 'CBJ', 'Dallas': 'DAL', 'Detroit': 'DET', 'Edmonton': 'EDM', 'Floride': 'FLA',
    'Los Angeles': 'LAK', 'Minnesota': 'MIN', 'Montréal': 'MTL', 'Nashville': 'NSH', 'New Jersey': 'NJD',
    'NY Islanders': 'NYI', 'NY Rangers': 'NYR', 'Ottawa': 'OTT', 'Philadelphie': 'PHI', 'Pittsburgh': 'PIT',
    'San Jose': 'SJS', 'Seattle': 'SEA', 'St. Louis': 'STL', 'Tampa Bay': 'TBL', 'Toronto': 'TOR', 'Utah': 'UTA',
    'Vancouver': 'VAN', 'Vegas': 'VGK', 'Washington': 'WSH', 'Winnipeg': 'WPG',
  };
  const ERREURS = {
    acces: 'Accès refusé : ta session de connexion n’est plus valide. Recharge la page.',
    session: 'Ta session a peut-être expiré. Recharge la page pour te reconnecter.',
    inconnu: "Ton courriel n'est pas dans la liste d'accès de la ligue.",
    equipe: "Ton courriel n'est lié à aucune équipe : seules les équipes peuvent miser.",
    minimum: 'Mise trop basse.',
    jetons: "Tu n'as pas assez de jetons disponibles.",
    joueur: "Ce joueur n'est plus agent libre (UFA).",
    deja: 'Une enchère est déjà en cours sur ce joueur : surenchéris sur celle-ci.',
    terminee: 'Cette enchère est terminée.',
    en_tete: 'Tu es déjà en tête de cette enchère.',
  };
  const quand = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const cibleId = new URLSearchParams(location.search).get('id') || '';

  let moi = null;          // { equipe, code }
  let donnees = null;
  let agents = [];
  let envoiEnCours = false;
  let cibleVue = false;

  function el(tag, cls, text){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    return e;
  }
  function logo(code){
    const img = el('img', 'ench-logo');
    img.src = 'https://lnhq.ca/Logos/' + code + '.png';
    img.alt = '';
    img.onerror = () => { img.style.visibility = 'hidden'; };
    return img;
  }
  const nomEquipe = code => ((donnees && donnees.equipes.find(e => e.code === code)) || {}).nom || code;
  const mesJetons = () => ((donnees && donnees.equipes.find(e => e.code === moi.code)) || {}).disponibles;

  function afficher(texte, erreur){
    const m = $('message');
    m.className = 'pub-message' + (erreur ? ' is-erreur' : ' is-succes');
    m.textContent = texte;
    m.hidden = false;
    m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function texteErreur(r){
    let t = ERREURS[r.erreur] || "L'opération a échoué. Réessaie dans un instant.";
    if(r.erreur === 'minimum' && r.minimum) t = `Mise trop basse : minimum ${r.minimum} jetons.`;
    if(r.erreur === 'jetons' && r.disponibles != null) t = `Pas assez de jetons : il t'en reste ${r.disponibles} de disponibles.`;
    return t;
  }

  async function api(chemin, corps){
    try{
      const rep = await fetch(chemin, corps ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) } : undefined);
      return await rep.json();
    }catch(err){
      return { ok: false, erreur: 'session' };
    }
  }

  /* ---------- Rendu ---------- */
  function carte(e){
    const c = el('article', 'ench-carte');
    c.id = 'e-' + e.id;
    const tete = el('div', 'ench-joueur');
    tete.append(el('strong', null, e.joueur), el('span', null, [e.position, e.ov && e.ov + ' OV'].filter(Boolean).join(' · ')));

    const meneur = el('div', 'ench-meneur');
    const qui = el('div', 'ench-qui');
    qui.append(el('span', 'ench-etiquette', 'En tête'), el('strong', null, nomEquipe(e.equipe)));
    const montant = el('div', 'ench-montant');
    montant.append(el('strong', null, e.mise), el('span', null, 'jetons'));
    meneur.append(logo(e.equipe), qui, montant);

    const chrono = el('div', 'ench-chrono');
    const reste = el('strong', 'ench-reste');
    reste.dataset.fin = e.fin;
    reste.textContent = E.tempsRestant(e.fin);
    chrono.append(el('span', null, 'Fin dans'), reste, el('span', 'ench-fin', quand.format(new Date(e.fin))));

    const minimum = e.mise + E.REGLES.surenchere;
    const zone = el('div');
    if(e.equipe === moi.code){
      zone.append(el('span', 'mise-note', '✓ Tu es en tête de cette enchère.'));
    }else{
      const form = el('form', 'mise-carte');
      form.noValidate = true;
      const champ = el('input');
      champ.type = 'number';
      champ.inputMode = 'numeric';
      champ.min = String(minimum);
      champ.step = '1';
      champ.value = String(minimum);
      champ.setAttribute('aria-label', 'Ta mise sur ' + e.joueur);
      const bouton = el('button', 'ench-bouton', 'Miser');
      bouton.type = 'submit';
      if(mesJetons() < minimum){ bouton.disabled = true; bouton.title = 'Pas assez de jetons disponibles'; }
      form.append(champ, bouton);
      form.addEventListener('submit', ev => { ev.preventDefault(); miser(e, Math.floor(Number(champ.value)), bouton); });
      zone.append(form);
    }
    const pied = el('div', 'ench-pied');
    pied.append(el('span', null, `${e.nb} mise${e.nb > 1 ? 's' : ''} · minimum ${minimum} jetons`));
    c.append(tete, meneur, chrono, zone, pied);
    return c;
  }

  function render(){
    const dispo = mesJetons();
    $('jetonsMoi').textContent = dispo != null ? `${dispo} jetons disponibles` : '';
    const enCours = donnees.encheres.filter(e => e.statut === 'En cours').sort((a, b) => new Date(a.fin) - new Date(b.fin));
    $('enCours').replaceChildren(...enCours.map(carte));
    $('aucuneEnCours').hidden = !!enCours.length;
    $('compteEnCours').textContent = enCours.length ? '(' + enCours.length + ')' : '';

    // Liste des agents libres, sans ceux déjà en enchère.
    const occupes = new Set(enCours.map(e => e.joueur + '|' + e.naissance));
    $('listeJoueurs').replaceChildren(...agents.filter(j => !occupes.has(j.nom + '|' + j.naissance)).map(j => {
      const o = el('option');
      o.value = j.nom;
      o.label = [j.position, j.ov && j.ov + ' OV', j.age && j.age + ' ans'].filter(Boolean).join(' · ');
      return o;
    }));
    $('montantLancer').max = String(Math.max(E.REGLES.miseMinimale, dispo || 0));
    $('aideLancer').textContent = agents.length
      ? `${agents.length} agents libres. Mise de départ : ${E.REGLES.miseMinimale} jetons minimum. Le chrono démarre à 24 h.`
      : "Aucun agent libre pour l'instant (colonne LNHQ TM = UFA dans PLAYERSDATABASE).";

    if(cibleId && !cibleVue){
      const cible = document.getElementById('e-' + cibleId);
      if(cible){ cible.classList.add('is-ciblee'); cible.scrollIntoView({ block: 'center' }); cibleVue = true; }
    }
  }

  async function recharger(){
    try{
      [donnees, agents] = await Promise.all([E.charger(), E.agentsLibres()]);
      render();
    }catch(err){
      console.error(err);
      afficher('Impossible de lire les enchères dans le classeur pour le moment.', true);
    }
  }

  /* ---------- Actions ---------- */
  async function lancer(ev){
    ev.preventDefault();
    if(envoiEnCours) return;
    const nom = $('joueur').value.trim();
    const montant = Math.floor(Number($('montantLancer').value));
    const joueur = agents.find(j => j.nom === nom);
    if(!joueur){ afficher('Choisis un joueur dans la liste des agents libres.', true); return; }
    if(!(montant >= E.REGLES.miseMinimale)){ afficher(`Mise de départ : ${E.REGLES.miseMinimale} jetons minimum.`, true); return; }
    if(!confirm(`Lancer une enchère sur ${joueur.nom} à ${montant} jetons ?`)) return;
    envoiEnCours = true;
    $('btnLancer').disabled = true;
    const r = await api('/api/encheres/lancer', { joueur: joueur.nom, naissance: joueur.naissance, montant });
    envoiEnCours = false;
    $('btnLancer').disabled = false;
    if(r.ok){
      afficher(`Enchère lancée sur ${joueur.nom} à ${montant} jetons.` + (r.discord === false ? ' (Annonce Discord non envoyée.)' : ''), false);
      $('joueur').value = '';
      await recharger();
    }else{
      afficher(texteErreur(r), true);
      recharger();
    }
  }

  async function miser(e, montant, bouton){
    if(envoiEnCours) return;
    const minimum = e.mise + E.REGLES.surenchere;
    if(!(montant >= minimum)){ afficher(`Mise trop basse : minimum ${minimum} jetons.`, true); return; }
    if(!confirm(`Miser ${montant} jetons sur ${e.joueur} ?`)) return;
    envoiEnCours = true;
    bouton.disabled = true;
    const r = await api('/api/encheres/miser', { id: e.id, montant });
    envoiEnCours = false;
    if(r.ok) afficher(`Tu es en tête sur ${e.joueur} avec ${montant} jetons.` + (r.discord === false ? ' (Annonce Discord non envoyée.)' : ''), false);
    else afficher(texteErreur(r), true);
    await recharger();
  }

  /* ---------- Démarrage ---------- */
  async function demarrer(){
    const r = await api('/api/moi');
    if(!r.ok){
      $('qui').textContent = '';
      $('refusTexte').textContent = ERREURS[r.erreur] || 'Accès impossible pour le moment.';
      $('refus').hidden = false;
      return;
    }
    moi = { equipe: r.equipe, code: CODES[r.equipe] || '' };
    if(!moi.code){
      $('qui').textContent = 'Connecté au nom de la ligue';
      $('refusTexte').textContent = ERREURS.equipe;
      $('refus').hidden = false;
      return;
    }
    $('qui').textContent = 'Tu mises pour ' + moi.equipe;
    $('formLancer').addEventListener('submit', lancer);
    $('contenu').hidden = false;
    await recharger();
    setInterval(() => document.querySelectorAll('.ench-reste').forEach(s => { s.textContent = E.tempsRestant(s.dataset.fin); }), 1000);
    // Données fraîches chaque minute, sauf pendant qu'on tape une mise.
    setInterval(() => {
      if(!document.hidden && !envoiEnCours && !(document.activeElement && document.activeElement.tagName === 'INPUT')) recharger();
    }, 60 * 1000);
  }

  demarrer();
})();
