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
  // Couleurs d'équipe (mêmes valeurs que TEAM_COLORS de lnhq.ca/equipe.html) : [primaire, foncée].
  const COULEURS = {
    ANA: ['#F47A38', '#0D0D0D'], BOS: ['#FFB81C', '#000000'], BUF: ['#FCB514', '#002654'], CGY: ['#C8102E', '#4B0009'],
    CAR: ['#CC0000', '#000000'], CHI: ['#CF0A2C', '#000000'], COL: ['#6F263D', '#041E42'], CBJ: ['#CE1126', '#002654'],
    DAL: ['#006847', '#111111'], DET: ['#CE1126', '#000000'], EDM: ['#FF4C00', '#041E42'], FLA: ['#C8102E', '#041E42'],
    LAK: ['#8C9396', '#000000'], MIN: ['#A6192E', '#154734'], MTL: ['#AF1E2D', '#192168'], NSH: ['#FFB81C', '#041E42'],
    NJD: ['#CE1126', '#000000'], NYI: ['#F47D30', '#00539B'], NYR: ['#CE1126', '#001E60'], OTT: ['#C52032', '#000000'],
    PHI: ['#F74902', '#000000'], PIT: ['#FCB514', '#000000'], SJS: ['#006D75', '#000000'], SEA: ['#99D9D9', '#001628'],
    STL: ['#FCB514', '#002F87'], TBL: ['#0057B8', '#000000'], TOR: ['#003E7E', '#000000'], UTA: ['#69B3E7', '#000000'],
    VAN: ['#00843D', '#041C2C'], VGK: ['#B4975A', '#101820'], WSH: ['#C8102E', '#041E42'], WPG: ['#004C97', '#041E42'],
  };
  const canaux = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const versHex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const assombrir = (hex, t) => versHex(canaux(hex).map(v => v * (1 - t)));
  const eclaircir = (hex, t) => versHex(canaux(hex).map(v => v + (255 - v) * t));
  const texteSur = hex => { const [r, g, b] = canaux(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#12181F' : '#FFFFFF'; };
  // Comme la page Équipe : bande, en-tête et cartes aux couleurs de l'équipe affichée.
  function appliquerCouleurs(c){
    const [primaire, foncee] = COULEURS[c] || [];
    if(!primaire) return;
    const racine = document.documentElement.style;
    const sombre = matchMedia('(prefers-color-scheme: dark)').matches;
    racine.setProperty('--accent', primaire);
    racine.setProperty('--accent-ink', texteSur(primaire));
    racine.setProperty('--accent-soft', sombre ? assombrir(primaire, 0.75) : eclaircir(primaire, 0.85));
    racine.setProperty('--nav-dark', foncee);
    racine.setProperty('--nav-ink', texteSur(foncee));
    const zone = $('zone');
    zone.style.setProperty('--al-couleur', primaire);
    zone.style.setProperty('--al-sombre', assombrir(foncee, 0.35));
  }
  const codeDe = nom => Object.keys(EQUIPES).find(c => EQUIPES[c][0] === nom) || '';
  const ERREURS = {
    acces: 'Accès refusé : ta session de connexion n’est plus valide. Recharge la page.',
    session: 'Ta session a peut-être expiré. Recharge la page pour te reconnecter.',
    inconnu: "Ton courriel n'est pas dans la liste d'accès de la ligue.",
    equipe: "Ton courriel n'est lié à aucune équipe.",
    pas_ton_equipe: "Tu peux seulement modifier l'alignement de ton équipe.",
  };

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
    // alignement.js vient de lnhq.ca : repli tant que la nouvelle version n'y est pas publiée.
    if(A.trierReservistes) A.trierReservistes(compo.reservistes);
    else compo.reservistes.sort((a, b) => (a.espoir - b.espoir) || (b.ov - a.ov));
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
    appliquerCouleurs(c);
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
    // Par défaut : son équipe seulement. Admin : la case « Mode admin » débloque le choix
    // d'une autre équipe (cochée d'office pour un admin sans équipe, ou si le lien de la page
    // Équipe demande une autre équipe : ?equipe=MTL).
    let depart = sienne;
    if(moi.admin){
      const demande = (new URLSearchParams(location.search).get('equipe') || '').toUpperCase();
      const sel = $('equipe'), caseAdmin = $('modeAdmin');
      sel.replaceChildren(...Object.keys(EQUIPES).sort((a, b) => EQUIPES[a][0].localeCompare(EQUIPES[b][0], 'fr')).map(c => {
        const o = document.createElement('option'); o.value = c; o.textContent = EQUIPES[c][0]; return o;
      }));
      if(EQUIPES[demande] && demande !== sienne) depart = demande;
      if(!depart) depart = 'ANA';
      caseAdmin.checked = !sienne || depart !== sienne;
      caseAdmin.disabled = !sienne;
      sel.value = depart;
      sel.hidden = !caseAdmin.checked;
      $('blocAdmin').hidden = false;
      const aller = c => {
        if(c === code) return true;
        if(modifie() && !confirm('Tes changements non enregistrés seront perdus. Continuer ?')) return false;
        chargerEquipe(c);
        return true;
      };
      sel.addEventListener('change', () => { if(!aller(sel.value)) sel.value = code; });
      caseAdmin.addEventListener('change', () => {
        // Mode admin retiré : retour à sa propre équipe.
        if(!caseAdmin.checked && !aller(sienne)){ caseAdmin.checked = true; return; }
        sel.hidden = !caseAdmin.checked;
        sel.value = code;
      });
    }
    const demandee = (new URLSearchParams(location.search).get('equipe') || '').toUpperCase();
    $('enregistrer').addEventListener('click', enregistrer);
    $('annuler').addEventListener('click', () => chargerEquipe(code));
    $('auto').addEventListener('click', automatique);
    window.addEventListener('beforeunload', ev => { if(modifie()){ ev.preventDefault(); ev.returnValue = ''; } });
    await chargerEquipe(depart);
    // Arrivé par le lien d'une autre équipe sans être admin : on le dit.
    if(!moi.admin && EQUIPES[demandee] && demandee !== sienne){
      afficher(`Tu peux seulement modifier l’alignement de ton équipe (${r.equipe}).`, true);
    }
  }

  demarrer();
})();
