/* LNHQ — base privée des ratings NHL 27 (publier.lnhq.ca/ratings.html, derrière Access).
   Données : /api/ratings (KV RATINGS du Worker, envoyé par ratings-envoyer.ps1). */
(function(){
  const $ = id => document.getElementById(id);

  // Groupes d'attributs : [clé du jeu, libellé, abréviation de colonne].
  const GROUPES = {
    P: [
      { id: 'pat', nom: 'Patinage', attr: [['Acceleration', 'Accélération', 'ACC'], ['Agility', 'Agilité', 'AGI'], ['Balance', 'Équilibre', 'ÉQU'], ['Endurance', 'Endurance', 'END'], ['Speed', 'Vitesse', 'VIT']] },
      { id: 'tir', nom: 'Tir', attr: [['Slap Shot Accuracy', 'Précision du lancer frappé', 'PLF'], ['Slap Shot Power', 'Puissance du lancer frappé', 'FLF'], ['Wrist Shot Accuracy', 'Précision du tir du poignet', 'PTP'], ['Wrist Shot Power', 'Puissance du tir du poignet', 'FTP']] },
      { id: 'man', nom: 'Maniement', attr: [['Deking', 'Feintes', 'FEI'], ['Hand-Eye', 'Coordination', 'COO'], ['Passing', 'Passes', 'PAS'], ['Puck Control', 'Contrôle de rondelle', 'CTR']] },
      { id: 'def', nom: 'Défense', attr: [['Def. Awareness', 'Sens défensif', 'SDÉ'], ['Faceoffs', 'Mises au jeu', 'MAJ'], ['Shot Blocking', 'Blocage de tirs', 'BLO'], ['Stick Checking', 'Harponnage', 'HAR']] },
      { id: 'phy', nom: 'Physique', attr: [['Aggressiveness', 'Agressivité', 'AGR'], ['Body Checking', 'Mise en échec', 'MEÉ'], ['Durability', 'Durabilité', 'DUR'], ['Fighting Skill', 'Combat', 'COM'], ['Strength', 'Force', 'FOR']] },
      { id: 'int', nom: 'Intelligence', attr: [['Discipline', 'Discipline', 'DIS'], ['Off. Awareness', 'Sens offensif', 'SOF'], ['Poise', 'Sang-froid', 'SFR']] },
    ],
    G: [
      { id: 'arr', nom: 'Arrêts', attr: [['Angles', 'Angles', 'ANG'], ['Breakaway', 'Échappées', 'ÉCH'], ['Five Hole', 'Entre les jambières', 'JAM'], ['Glove High', 'Mitaine haut', 'MIH'], ['Glove Low', 'Mitaine bas', 'MIB'], ['Stick High', 'Côté bâton haut', 'BÂH'], ['Stick Low', 'Côté bâton bas', 'BÂB']] },
      { id: 'jeu', nom: 'Jeu', attr: [['Rebound Control', 'Contrôle des retours', 'RET'], ['Recover', 'Récupération', 'RÉC'], ['Vision', 'Vision', 'VIS'], ['Poise', 'Sang-froid', 'SFR'], ['Poke Check', 'Harponnage', 'HAR'], ['Passing', 'Passes', 'PAS'], ['Puck Playing Freq.', 'Jeu de rondelle', 'JRO']] },
      { id: 'phy', nom: 'Physique', attr: [['Aggressiveness', 'Agressivité', 'AGR'], ['Agility', 'Agilité', 'AGI'], ['Durability', 'Durabilité', 'DUR'], ['Endurance', 'Endurance', 'END'], ['Speed', 'Vitesse', 'VIT']] },
    ],
  };
  const CODES = {
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
  // Habiletés : le scanner colle ou coupe parfois les mots (« TAPETO TAPE », « ONET ») :
  // on compare sans espaces ni ponctuation pour retrouver le nom officiel.
  const HABILETES = ['Ankle Breaker', 'Backhand Beauty', 'Big Rig', 'Big Tipper', 'Born Leader', 'Elite Edges', 'Hipster',
    'No Contest', 'One T', 'Pressure+', 'Quick Draw', 'Quick Pick', 'Quick Release', 'Rocket', 'Second Wind', 'Send It',
    'Spark Plug', "Stick 'Em Up", 'Tape to Tape', 'Truculence', 'Unstoppable', 'Warrior', 'Wheels'];
  const cleHab = s => (s || '').toUpperCase().replace(/[^A-Z+]/g, '');
  const PAR_CLE = Object.fromEntries(HABILETES.map(h => [cleHab(h), h]));
  const nomHab = s => PAR_CLE[cleHab(s)] || titre(s);
  const NIVEAUX = { 'ELITE': { nom: 'Élite', rang: 3, cls: 'h-elite' }, 'ALL-STAR': { nom: 'Étoile', rang: 2, cls: 'h-etoile' }, 'SPECIALIST': { nom: 'Spécialiste', rang: 1, cls: 'h-spec' } };
  const niveauHab = s => NIVEAUX[cleHab(s) === 'ALLSTAR' ? 'ALL-STAR' : cleHab(s)] || { nom: titre(s), rang: 0, cls: '' };
  const POSITIONS ={ C: 'C', LW: 'AG', RW: 'AD', LD: 'DG', RD: 'DD', G: 'G' };
  const TIR = { LEFT: 'Gauche', RIGHT: 'Droite' };
  const codeEquipe = nom => CODES[(nom || '').trim().toLowerCase()] || '';
  const posFr = p => (p || '').split('/').map(x => POSITIONS[x] || x).join('/');
  const titre = s => (s || '').toLowerCase().replace(/(^|[\s-])\S/g, c => c.toUpperCase());

  let joueurs = [];
  const etat = { type: 'P', groupe: 'resume', tri: 'ov', sens: -1, texte: '', equipe: '', position: '', typeJ: '', hab: '', niv: 0 };

  function el(tag, cls, text){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    return e;
  }
  const moyenne = (j, g) => {
    const v = g.attr.map(a => j.attributs?.[a[0]]).filter(x => typeof x === 'number');
    return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
  };
  const niveau = v => v == null ? '' : v >= 90 ? 'n-elite' : v >= 85 ? 'n-tres' : v >= 80 ? 'n-bon' : v >= 70 ? 'n-moyen' : 'n-faible';
  function logo(code){
    const img = el('img', 'rt-logo');
    img.alt = '';
    img.loading = 'lazy';
    if(code) img.src = 'https://lnhq.ca/Logos/' + code + '.png'; else img.hidden = true;
    return img;
  }

  // Colonnes du tableau selon le groupe choisi : Résumé = OV + moyenne de chaque groupe.
  // Colonne des habiletés : triée par force (Élite = 3, Étoile = 2, Spécialiste = 1).
  const COL_HAB = { cle: 'hab', abr: 'Habiletés', nom: 'Habiletés (tri par force)', hab: true, val: j => j.habs.length ? j.habs.reduce((s, h) => s + h.rang, 0) : null };
  function colonnes(){
    const gs = GROUPES[etat.type];
    if(etat.groupe === 'resume') return [{ cle: 'ov', abr: 'OV', nom: 'Overall', val: j => j.overall ?? null },
      ...gs.map(g => ({ cle: 'g-' + g.id, abr: g.nom.slice(0, 3).toUpperCase(), nom: 'Moyenne ' + g.nom.toLowerCase(), val: j => moyenne(j, g) })), COL_HAB];
    if(etat.groupe === 'hab') return [{ cle: 'ov', abr: 'OV', nom: 'Overall', val: j => j.overall ?? null }, COL_HAB];
    const g = gs.find(x => x.id === etat.groupe) || gs[0];
    return [{ cle: 'ov', abr: 'OV', nom: 'Overall', val: j => j.overall ?? null },
      ...g.attr.map(([k, nom, abr]) => ({ cle: 'a-' + k, abr, nom, val: j => j.attributs?.[k] ?? null }))];
  }
  const INFOS = [
    { cle: 'nom', abr: 'Joueur', val: j => j.nom + ' ' + j.prenom, texte: true },
    { cle: 'equipe', abr: 'Équipe', val: j => j.code, texte: true },
    { cle: 'pos', abr: 'Pos', val: j => j.position, texte: true },
    { cle: 'age', abr: 'Âge', val: j => j.age ?? null },
  ];

  function filtres(){
    const t = etat.texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return joueurs.filter(j => (etat.type === 'G') === (j.position === 'G')
      && (!t || j.recherche.includes(t))
      && (!etat.equipe || j.code === etat.equipe)
      && (!etat.typeJ || j.type === etat.typeJ)
      && (!etat.hab || j.habs.some(h => h.nom === etat.hab && h.rang >= etat.niv))
      && (etat.hab || !etat.niv || j.habs.some(h => h.rang >= etat.niv))
      && (!etat.position || j.position.split('/').some(p => etat.position === 'D' ? /D$/.test(p) : p === etat.position)));
  }

  function render(){
    document.querySelectorAll('.rt-onglets [data-type]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.type === etat.type)));
    $('position').hidden = etat.type === 'G';
    // Types de joueur du lot affiché.
    const types = [...new Set(joueurs.filter(j => (etat.type === 'G') === (j.position === 'G')).map(j => j.type).filter(Boolean))].sort();
    if(!types.includes(etat.typeJ)) etat.typeJ = '';
    $('typeJ').replaceChildren(new Option('Tous les types', ''), ...types.map(t => new Option(titre(t), t)));
    $('typeJ').value = etat.typeJ;
    // Habiletés présentes dans le lot affiché.
    const habs = [...new Set(joueurs.filter(j => (etat.type === 'G') === (j.position === 'G')).flatMap(j => j.habs.map(h => h.nom)))].sort((a, b) => a.localeCompare(b, 'fr'));
    if(!habs.includes(etat.hab)) etat.hab = '';
    $('hab').replaceChildren(new Option('Toutes les habiletés', ''), ...habs.map(h => new Option(h, h)));
    $('hab').value = etat.hab;
    $('hab').hidden = $('niv').hidden = !habs.length;

    const groupes = [{ id: 'resume', nom: 'Résumé' }, ...GROUPES[etat.type], ...(habs.length ? [{ id: 'hab', nom: 'Habiletés' }] : [])];
    if(!groupes.some(g => g.id === etat.groupe)) etat.groupe = 'resume';
    $('groupes').replaceChildren(...groupes.map(g => {
      const b = el('button', null, g.nom);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(g.id === etat.groupe));
      b.addEventListener('click', () => { etat.groupe = g.id; if(!colonnes().some(c => c.cle === etat.tri) && !INFOS.some(c => c.cle === etat.tri)) etat.tri = 'ov'; render(); });
      return b;
    }));

    const cols = colonnes();
    const toutes = [...INFOS, ...cols];
    const col = toutes.find(c => c.cle === etat.tri) || cols[0];
    const lot = filtres().sort((a, b) => {
      const va = col.val(a), vb = col.val(b);
      if(va == null && vb == null) return a.nom.localeCompare(b.nom, 'fr');
      if(va == null) return 1;            // valeur manquante toujours en bas
      if(vb == null) return -1;
      const d = col.texte ? String(va).localeCompare(String(vb), 'fr') : va - vb;
      return d * etat.sens || a.nom.localeCompare(b.nom, 'fr');
    });
    const total = joueurs.filter(j => (etat.type === 'G') === (j.position === 'G')).length;
    $('compte').textContent = lot.length === total ? `${total} ${etat.type === 'G' ? 'gardiens' : 'patineurs'}` : `${lot.length} sur ${total}`;

    const thead = el('thead'), tr = el('tr');
    tr.append(el('th', 'rt-rang', '#'));
    toutes.forEach(c => {
      const th = el('th', c.texte ? 'is-texte' : '');
      if(c.cle === 'nom') th.classList.add('rt-fige');
      const b = el('button', null, c.abr);
      b.type = 'button';
      if(c.nom) b.title = c.nom;
      if(c.cle === etat.tri){ th.classList.add('is-tri'); th.setAttribute('aria-sort', etat.sens < 0 ? 'descending' : 'ascending'); b.textContent += etat.sens < 0 ? ' ▾' : ' ▴'; }
      b.addEventListener('click', () => {
        if(etat.tri === c.cle) etat.sens = -etat.sens;
        else { etat.tri = c.cle; etat.sens = c.texte ? 1 : -1; }
        render();
      });
      th.append(b);
      tr.append(th);
    });
    thead.append(tr);

    const tbody = el('tbody');
    lot.forEach((j, i) => {
      const r = el('tr');
      r.tabIndex = 0;
      r.addEventListener('click', () => ouvrir(j));
      r.addEventListener('keydown', e => { if(e.key === 'Enter') ouvrir(j); });
      r.append(el('td', 'rt-rang', String(i + 1)));
      const nom = el('td', 'rt-fige rt-nom');
      nom.append(el('b', null, j.nom), document.createTextNode(' ' + j.prenom));
      const eq = el('td', 'rt-eq');
      eq.append(logo(j.code), document.createTextNode(j.code || '—'));
      r.append(nom, eq, el('td', 'is-texte', posFr(j.position)), el('td', null, j.age ?? ''));
      cols.forEach(c => {
        if(c.hab){
          const td = el('td', 'is-texte rt-habs');
          td.append(...j.habs.map(h => el('span', 'rt-puce ' + h.cls, h.nom)));
          if(!j.habs.length) td.textContent = '—';
          if(c.cle === etat.tri) td.classList.add('is-tri');
          r.append(td);
          return;
        }
        const v = c.val(j);
        const td = el('td', 'rt-val ' + niveau(v) + (c.cle === 'ov' ? ' rt-ov-col' : ''), v ?? '—');
        if(c.cle === etat.tri) td.classList.add('is-tri');
        r.append(td);
      });
      tbody.append(r);
    });
    if(!lot.length){
      const r = el('tr'), td = el('td', 'rt-vide', 'Aucun joueur ne correspond aux filtres.');
      td.colSpan = toutes.length + 1;
      r.append(td);
      tbody.append(r);
    }
    $('table').replaceChildren(thead, tbody);
  }

  function ouvrir(j){
    $('ficheLogo').src = j.code ? 'https://lnhq.ca/Logos/' + j.code + '.png' : 'https://lnhq.ca/logo-lnhq.png';
    $('ficheNom').textContent = j.prenom + ' ' + j.nom;
    $('ficheSous').textContent = [j.numero != null ? '#' + j.numero : '', posFr(j.position), j.equipe].filter(Boolean).join(' · ');
    $('ficheOv').textContent = j.overall ?? '—';
    $('ficheOv').className = 'rt-ov ' + niveau(j.overall);
    const bio = [['Âge', j.age], ['Taille', j.taille], ['Poids', j.poids ? j.poids + ' lb' : ''], ['Tir', TIR[j.tir] || titre(j.tir)],
      ['Type', titre(j.type)], ['Repêchage', j.repechage ? j.repechage + (j.repeche_par ? ' · ' + j.repeche_par : '') : 'Non repêché']];
    $('ficheBio').replaceChildren(...bio.filter(b => b[1] != null && b[1] !== '').flatMap(([k, v]) => [el('dt', null, k), el('dd', null, String(v))]));
    $('ficheHab').replaceChildren(...j.habs.map(h => {
      const p = el('span', 'rt-hab ' + h.cls);
      p.append(el('b', null, h.nom), el('small', null, h.niveau));
      return p;
    }));
    $('ficheHab').hidden = !j.habs.length;
    $('ficheAttr').replaceChildren(...GROUPES[j.position === 'G' ? 'G' : 'P'].map(g => {
      const bloc = el('section', 'rt-groupe');
      const m = moyenne(j, g);
      const h = el('h4', null, g.nom);
      h.append(el('span', 'rt-moy ' + niveau(m), m ?? '—'));
      bloc.append(h);
      g.attr.forEach(([k, nom]) => {
        const v = j.attributs?.[k];
        const ligne = el('div', 'rt-ligne');
        const barre = el('span', 'rt-barre');
        const plein = el('i', niveau(v));
        plein.style.width = (v || 0) + '%';
        barre.append(plein);
        ligne.append(el('span', 'rt-lib', nom), barre, el('b', niveau(v), v ?? '—'));
        bloc.append(ligne);
      });
      return bloc;
    }));
    $('fiche').showModal();
  }

  function brancher(){
    document.querySelectorAll('.rt-onglets [data-type]').forEach(b => b.addEventListener('click', () => {
      if(etat.type === b.dataset.type) return;
      etat.type = b.dataset.type;
      etat.groupe = 'resume';
      etat.tri = 'ov'; etat.sens = -1;
      render();
    }));
    $('recherche').addEventListener('input', e => { etat.texte = e.target.value.trim(); render(); });
    $('equipe').addEventListener('change', e => { etat.equipe = e.target.value; render(); });
    $('position').addEventListener('change', e => { etat.position = e.target.value; render(); });
    $('typeJ').addEventListener('change', e => { etat.typeJ = e.target.value; render(); });
    $('hab').addEventListener('change', e => { etat.hab = e.target.value; render(); });
    $('niv').addEventListener('change', e => { etat.niv = Number(e.target.value); render(); });
    $('ficheFermer').addEventListener('click', () => $('fiche').close());
    // Clic sur le fond (hors de la fiche) : fermer.
    $('fiche').addEventListener('click', e => { if(e.target === $('fiche')) $('fiche').close(); });
  }

  async function demarrer(){
    let d;
    try{ d = await (await fetch('/api/ratings', { cache: 'no-store' })).json(); }
    catch(e){ d = { ok: false, erreur: 'session' }; }
    if(!d.ok){
      $('qui').textContent = '';
      $('refusTexte').textContent = d.erreur === 'vide' ? "La base n'a pas encore été envoyée (ratings-envoyer.ps1)."
        : d.erreur === 'acces' ? 'Accès refusé : recharge la page pour te reconnecter.'
        : 'Impossible de charger la base pour le moment. Recharge la page.';
      $('refus').hidden = false;
      return;
    }
    joueurs = Object.values(d.joueurs || {}).map(j => Object.assign({}, j, {
      prenom: j.prenom || '', nom: j.nom || '', position: j.position || '', code: codeEquipe(j.equipe),
      habs: (j.habiletes || []).map(h => { const n = niveauHab(h.niveau); return { nom: nomHab(h.nom), niveau: n.nom, rang: n.rang, cls: n.cls }; })
        .sort((a, b) => b.rang - a.rang),
      recherche: ((j.prenom || '') + ' ' + (j.nom || '')).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(),
    }));
    const equipes = [...new Set(joueurs.map(j => j.code).filter(Boolean))].sort();
    $('equipe').append(...equipes.map(c => new Option(c, c)));
    const maj = d.misAJour ? new Date(d.misAJour) : null;
    $('qui').textContent = joueurs.length + ' joueurs' + (maj && !isNaN(maj) ? ' · mis à jour le ' + maj.toLocaleString('fr-CA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '');
    $('contenu').hidden = false;
    brancher();
    render();
    ouvrirDemande();
  }

  // ?joueur=Nom, Prénom (lien de la carte au survol de lnhq.ca) : ouvre sa fiche.
  // Prénom écrit autrement (Gabe / Gabriel) : le nom de famille seul s'il est unique.
  function ouvrirDemande(){
    const demande = new URLSearchParams(location.search).get('joueur');
    if(!demande) return;
    const cle = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
    const v = demande.indexOf(',');
    const nom = cle(v > 0 ? demande.slice(0, v) : demande), prenom = cle(v > 0 ? demande.slice(v + 1) : '');
    let trouves = joueurs.filter(j => cle(j.nom) === nom && cle(j.prenom) === prenom);
    if(!trouves.length) trouves = joueurs.filter(j => cle(j.nom) === nom);
    // Homonymes : l'équipe passée dans le lien (&equipe=CODE) départage.
    const equipe = (new URLSearchParams(location.search).get('equipe') || '').toUpperCase();
    if(trouves.length > 1 && equipe) trouves = trouves.filter(j => j.code === equipe);
    if(trouves.length !== 1){
      // Introuvable ou homonymes : la recherche montre les candidats.
      etat.texte = v > 0 ? demande.slice(0, v).trim() : demande;
      $('recherche').value = etat.texte;
      render();
      return;
    }
    const j = trouves[0];
    etat.type = j.position === 'G' ? 'G' : 'P';
    render();
    ouvrir(j);
  }

  demarrer();
})();
