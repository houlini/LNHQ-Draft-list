/* LNHQ — modification de l'alignement par le DG (publier.lnhq.ca, derrière Cloudflare Access).
   Toucher un joueur, puis un autre, les échange (alignement ↔ alignement ou ↔ réservistes).
   Le script revérifie l'équipe du membre et que chaque joueur appartient bien à l'équipe. */
(function(){
  const $ = id => document.getElementById(id);
  const A = window.LNHQ_ALIGNEMENT;
  // Code → [nom dans l'onglet ACCES, slug de lnhq.ca/equipe.html]
  const EQUIPES = {
    ANA: ['Anaheim', 'anaheim'], BOS: ['Boston', 'boston'], BUF: ['Buffalo', 'buffalo'], CGY: ['Calgary', 'calgary'],
    CAR: ['Caroline', 'carolina'], CHI: ['Chicago', 'chicago'], COL: ['Colorado', 'colorado'], CBJ: ['Columbus', 'columbus'],
    DAL: ['Dallas', 'dallas'], DET: ['Detroit', 'detroit'], EDM: ['Edmonton', 'edmonton'], FLA: ['Floride', 'florida'],
    LAK: ['Los Angeles', 'los-angeles'], MIN: ['Minnesota', 'minnesota'], MTL: ['Montréal', 'montreal'], NSH: ['Nashville', 'nashville'],
    NJD: ['New Jersey', 'new-jersey'], NYI: ['NY Islanders', 'ny-islanders'], NYR: ['NY Rangers', 'ny-rangers'], OTT: ['Ottawa', 'ottawa'],
    PHI: ['Philadelphie', 'philadelphia'], PIT: ['Pittsburgh', 'pittsburgh'], SJS: ['San Jose', 'san-jose'], SEA: ['Seattle', 'seattle'],
    STL: ['St. Louis', 'st-louis'], TBL: ['Tampa Bay', 'tampa-bay'], TOR: ['Toronto', 'toronto'], UTA: ['Utah', 'utah'],
    VAN: ['Vancouver', 'vancouver'], VGK: ['Vegas', 'vegas'], WSH: ['Washington', 'washington'], WPG: ['Winnipeg', 'winnipeg'],
  };
  const codeDe = nom => Object.keys(EQUIPES).find(c => EQUIPES[c][0] === nom) || '';
  const ERREURS = {
    acces: 'Accès refusé : ta session de connexion n’est plus valide. Recharge la page.',
    session: 'Ta session a peut-être expiré. Recharge la page pour te reconnecter.',
    inconnu: "Ton courriel n'est pas dans la liste d'accès de la ligue.",
    equipe: "Ton courriel n'est lié à aucune équipe.",
    pas_ton_equipe: "Tu peux seulement modifier l'alignement de ton équipe.",
  };
  const ordrePo = { C: 0, L: 1, R: 2, D: 3, G: 4 };

  let moi = null;          // { code, admin }
  let code = '';
  let joueurs = [];
  let compo = null;        // { places: { A1C: joueur|null }, reservistes: [] }
  let original = '';       // dernier alignement enregistré ('' = jamais enregistré)
  let initial = '';        // alignement au chargement (pour « Annuler »)
  let choisie = '';        // clé de la carte touchée (place ou 'R:' + id)
  let envoi = false;

  function afficher(texte, erreur){
    const m = $('message');
    m.className = 'dg-message ' + (erreur ? 'is-erreur' : 'is-ok');
    m.textContent = texte;
    m.hidden = !texte;
  }
  async function api(chemin, corps){
    try{
      const rep = await fetch(chemin, corps ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) } : undefined);
      return await rep.json();
    }catch(e){ return { ok: false, erreur: 'session' }; }
  }

  const empreinte = () => JSON.stringify(A.PLACES.map(p => (compo.places[p.id] || {}).id || ''));
  const modifie = () => !!compo && empreinte() !== initial;
  function majBoutons(){
    $('enregistrer').disabled = envoi || !compo || empreinte() === original;
    $('annuler').disabled = envoi || !modifie();
  }

  function trierReservistes(){
    compo.reservistes.sort((a, b) => (a.espoir - b.espoir) || ((ordrePo[a.po] ?? 9) - (ordrePo[b.po] ?? 9)) || (b.ov - a.ov));
  }

  function joueurDe(cle){
    return cle.startsWith('R:') ? compo.reservistes.find(j => 'R:' + j.id === cle) || null : compo.places[cle] || null;
  }

  // Échange de deux cartes. Deux réservistes : on change seulement la carte choisie.
  function echanger(a, b){
    const ra = a.startsWith('R:'), rb = b.startsWith('R:');
    if(ra && rb) return false;
    if(!ra && !rb){
      [compo.places[a], compo.places[b]] = [compo.places[b], compo.places[a]];
      return true;
    }
    const place = ra ? b : a, res = ra ? a : b;
    const entrant = joueurDe(res), sortant = compo.places[place];
    compo.reservistes = compo.reservistes.filter(j => j !== entrant);
    if(sortant) compo.reservistes.push(sortant);
    compo.places[place] = entrant;
    trierReservistes();
    return true;
  }

  function toucher(cle){
    if(envoi) return;
    if(!choisie){
      if(!joueurDe(cle) && cle.startsWith('R:')) return;
      choisie = cle;
    }else if(choisie === cle){
      choisie = '';
    }else if(echanger(choisie, cle)){
      choisie = '';
      afficher('', false);
    }else{
      choisie = cle;
    }
    rendre();
  }

  function rendre(){
    A.rendre($('contenu'), compo, {
      surCarte: (cle, carte) => {
        carte.tabIndex = 0;
        carte.setAttribute('role', 'button');
        carte.classList.toggle('is-choisie', cle === choisie);
        carte.addEventListener('click', () => toucher(cle));
        carte.addEventListener('keydown', ev => { if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); toucher(cle); } });
      },
    });
    majBoutons();
  }

  async function chargerEquipe(c){
    code = c;
    choisie = '';
    afficher('', false);
    $('lienEquipe').href = 'https://lnhq.ca/equipe.html?team=' + EQUIPES[c][1] + '&vue=alignement';
    $('contenu').replaceChildren();
    $('zone').hidden = false;
    try{
      const [j, s] = await Promise.all([A.chargerJoueurs(c), A.chargerSauvegarde(c)]);
      joueurs = j;
      compo = A.composer(joueurs, s);
      initial = empreinte();
      original = s ? initial : '';   // jamais enregistré : « Enregistrer » permet de figer l'alignement auto
      rendre();
    }catch(e){
      afficher('Impossible de lire les joueurs de l’équipe pour le moment.', true);
    }
  }

  async function enregistrer(){
    if(envoi || !compo) return;
    envoi = true; majBoutons();
    $('enregistrer').textContent = 'Enregistrement…';
    const places = {};
    A.PLACES.forEach(p => { places[p.id] = (compo.places[p.id] || {}).id || ''; });
    const r = await api('/api/alignement/sauver', { equipe: code, places });
    envoi = false;
    $('enregistrer').textContent = 'Enregistrer';
    if(r.ok){
      original = initial = empreinte();
      afficher('Alignement enregistré. Il apparaît sur la page de l’équipe d’ici quelques secondes.', false);
    }else{
      afficher(r.erreur === 'joueur' ? `${r.joueur} ne fait plus partie de l’équipe : recharge la page.`
        : r.erreur === 'doublon' ? `${r.joueur} est placé deux fois.`
        : ERREURS[r.erreur] || "L'enregistrement a échoué. Réessaie dans un instant.", true);
    }
    majBoutons();
  }

  async function automatique(){
    if(envoi || !confirm('Revenir à l’alignement automatique (par position et overall) ? Ton alignement enregistré sera effacé.')) return;
    envoi = true; majBoutons();
    const r = await api('/api/alignement/sauver', { equipe: code, automatique: true });
    envoi = false;
    if(r.ok){
      compo = A.composer(joueurs, null);
      initial = empreinte();
      original = '';
      choisie = '';
      rendre();
      afficher('Alignement automatique rétabli.', false);
    }else{
      afficher(ERREURS[r.erreur] || 'Le changement a échoué.', true);
      majBoutons();
    }
  }

  async function demarrer(){
    const r = await api('/api/moi');
    const sienne = r.ok ? codeDe(r.equipe) : '';
    if(!r.ok || (!sienne && !r.annonces)){
      $('qui').textContent = '';
      $('refusTexte').textContent = !r.ok ? (ERREURS[r.erreur] || 'Accès impossible pour le moment.') : ERREURS.equipe;
      $('refus').hidden = false;
      return;
    }
    moi = { code: sienne, admin: r.annonces === true };
    $('qui').textContent = 'Alignement' + (sienne ? ' de ' + r.equipe : '') + (moi.admin ? ' · admin' : '');
    $('barre').hidden = false;
    let depart = sienne;
    if(moi.admin){
      // Admin : choix de l'équipe (?equipe=MTL dans l'adresse, sinon la sienne).
      const demande = (new URLSearchParams(location.search).get('equipe') || '').toUpperCase();
      if(EQUIPES[demande]) depart = demande;
      if(!depart) depart = 'ANA';
      const sel = $('equipe');
      sel.replaceChildren(...Object.keys(EQUIPES).sort((a, b) => EQUIPES[a][0].localeCompare(EQUIPES[b][0], 'fr')).map(c => {
        const o = document.createElement('option'); o.value = c; o.textContent = EQUIPES[c][0]; return o;
      }));
      sel.value = depart;
      sel.hidden = false;
      sel.addEventListener('change', () => {
        if(modifie() && !confirm('Tes changements non enregistrés seront perdus. Continuer ?')){ sel.value = code; return; }
        chargerEquipe(sel.value);
      });
    }
    $('enregistrer').addEventListener('click', enregistrer);
    $('annuler').addEventListener('click', () => chargerEquipe(code));
    $('auto').addEventListener('click', automatique);
    window.addEventListener('beforeunload', ev => { if(modifie()){ ev.preventDefault(); ev.returnValue = ''; } });
    chargerEquipe(depart);
  }

  demarrer();
})();
