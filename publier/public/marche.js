/* LNHQ — marché des échanges du DG (dg.lnhq.ca/marche.html) : posture, joueurs disponibles et
   joueurs recherchés, affichés dans La Gazette LNHQ du bureau du DG. Le script revérifie l'équipe
   du membre, que chaque joueur disponible appartient bien à l'équipe et les valeurs des critères. */
(function(){
  const $ = id => document.getElementById(id);
  const M = window.LNHQ_MARCHE;
  const EQUIPES = {
    ANA: 'Anaheim', BOS: 'Boston', BUF: 'Buffalo', CGY: 'Calgary', CAR: 'Caroline', CHI: 'Chicago', COL: 'Colorado', CBJ: 'Columbus',
    DAL: 'Dallas', DET: 'Detroit', EDM: 'Edmonton', FLA: 'Floride', LAK: 'Los Angeles', MIN: 'Minnesota', MTL: 'Montréal', NSH: 'Nashville',
    NJD: 'New Jersey', NYI: 'NY Islanders', NYR: 'NY Rangers', OTT: 'Ottawa', PHI: 'Philadelphie', PIT: 'Pittsburgh', SJS: 'San Jose', SEA: 'Seattle',
    STL: 'St. Louis', TBL: 'Tampa Bay', TOR: 'Toronto', UTA: 'Utah', VAN: 'Vancouver', VGK: 'Vegas', WSH: 'Washington', WPG: 'Winnipeg',
  };
  const codeDe = nom => Object.keys(EQUIPES).find(c => EQUIPES[c] === nom) || '';
  const ERREURS = {
    acces: 'Accès refusé : ta session de connexion n’est plus valide. Recharge la page.',
    session: 'Ta session a peut-être expiré. Recharge la page pour te reconnecter.',
    inconnu: "Ton compte n'est pas dans la liste d'accès de la ligue.",
    equipe: "Ton compte n'est lié à aucune équipe.",
    pas_ton_equipe: 'Tu peux seulement modifier le marché de ton équipe.',
    critere: 'Un des critères est invalide : recharge la page.',
    trop: 'Trop de joueurs : 12 disponibles et 6 types recherchés au maximum.',
  };
  const GROUPES = [['A', 'Attaquants'], ['D', 'Défenseurs'], ['G', 'Gardiens'], ['CHOIX', 'Choix de repêchage']];

  let moi = null, code = '', roster = [], etat = null, initial = '', envoi = false;
  let marche = new Map(), ligue = null;   // tout le marché et les joueurs de la ligue (correspondances)

  function el(tag, cls, text){ const e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }
  function afficher(texte, erreur){ const m = $('message'); m.className = 'dg-message ' + (erreur ? 'is-erreur' : 'is-ok'); m.textContent = texte; m.hidden = !texte; if(texte) m.scrollIntoView({ block: 'nearest' }); }
  async function api(chemin, corps){
    try{
      const rep = await fetch(chemin, corps ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) } : undefined);
      return await rep.json();
    }catch(e){ return { ok: false, erreur: 'session' }; }
  }
  const empreinte = () => JSON.stringify(etat);
  const modifie = () => !!etat && empreinte() !== initial;
  function majBoutons(){
    $('enregistrer').disabled = envoi || !modifie();
    $('annuler').disabled = envoi || !modifie();
    $('compteDispo').textContent = etat ? etat.disponibles.length + ' / ' + M.MAX_DISPONIBLES : '';
    $('compteRech').textContent = etat ? etat.recherches.length + ' / ' + M.MAX_RECHERCHES : '';
    $('ajouter').disabled = !etat || etat.recherches.length >= M.MAX_RECHERCHES;
  }
  const changer = () => { afficher('', false); majBoutons(); };

  function rendrePostures(){
    $('postures').replaceChildren(...M.CRITERES.posture.map(([v, t]) => {
      const b = el('button', 'mc-posture' + (v ? ' ' + v : ''), t); b.type = 'button';
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(etat.posture === v));
      b.addEventListener('click', () => { etat.posture = v; rendrePostures(); changer(); });
      return b;
    }));
  }

  function rendreDisponibles(){
    const choisis = new Map(etat.disponibles.map(d => [d.j, d]));
    const blocs = GROUPES.map(([g, titre]) => {
      const liste = roster.filter(j => j.groupe === g).sort((a, b) => b.ov - a.ov || a.nom.localeCompare(b.nom));
      if(!liste.length) return null;
      const bloc = el('div', 'mc-groupe');
      bloc.append(el('h3', null, titre));
      liste.forEach(j => {
        const d = choisis.get(j.id);
        const ligne = el('div', 'mc-joueur' + (d ? ' is-choisi' : ''));
        const lab = el('label');
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!d;
        cb.disabled = !d && etat.disponibles.length >= M.MAX_DISPONIBLES;
        const infos = j.choix ? [] : [M.poCourt(j.po), j.ov + ' OV', j.age + ' ans', M.millions(j.salaire), j.ans ? j.ans + ' an' + (j.ans > 1 ? 's' : '') : ''].filter(Boolean);
        lab.append(cb, el('b', null, j.choix ? j.id : j.nom), el('small', null, infos.join(' · ')));
        cb.addEventListener('change', () => {
          if(cb.checked) etat.disponibles.push({ j: j.id, n: '' });
          else etat.disponibles = etat.disponibles.filter(x => x.j !== j.id);
          rendreDisponibles(); changer();
        });
        ligne.append(lab);
        if(d){
          const note = el('input', 'mc-note'); note.maxLength = M.MAX_NOTE; note.value = d.n || '';
          note.placeholder = 'Note (facultative) : ce que tu veux en retour, conditions…';
          note.setAttribute('aria-label', 'Note pour ' + (j.choix ? j.id : j.nom));
          note.addEventListener('input', () => { d.n = note.value; majBoutons(); });
          ligne.append(note);
        }
        bloc.append(ligne);
      });
      return bloc;
    }).filter(Boolean);
    // Joueur parti depuis (échange) : signalé, et retiré à l'enregistrement.
    const partis = etat.disponibles.filter(d => !roster.some(j => j.id === d.j));
    if(partis.length) blocs.unshift(el('p', 'dg-message is-erreur', 'Ne fait plus partie de l’équipe (sera retiré) : ' + partis.map(d => M.prenomNom(d.j)).join(', ')));
    $('disponibles').replaceChildren(...blocs);
  }

  function select(cle, valeur, maj){
    const s = el('select'); s.setAttribute('aria-label', cle);
    M.CRITERES[cle].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; s.append(o); });
    s.value = valeur || '';
    s.addEventListener('change', () => maj(s.value));
    return s;
  }
  function rendreRecherches(){
    $('recherches').replaceChildren(...etat.recherches.map((r, i) => {
      const carte = el('div', 'mc-recherche');
      const tete = el('div', 'mc-recherche-tete');
      const resume = el('b', null, M.decrire(r));
      const suppr = el('button', 'mc-suppr', '✕'); suppr.type = 'button'; suppr.setAttribute('aria-label', 'Retirer ce type de joueur');
      suppr.addEventListener('click', () => { etat.recherches.splice(i, 1); rendreRecherches(); changer(); });
      tete.append(resume, suppr);
      const grille = el('div', 'mc-criteres');
      const maj = () => { resume.textContent = M.decrire(r); correspondances(r, liste); changer(); };
      const champ = (titre, ctrl) => { const l = el('label', 'mc-champ'); l.append(el('span', null, titre), ctrl); return l; };
      const nombre = (cle, min, max, ph) => {
        const n = el('input'); n.type = 'number'; n.inputMode = 'numeric'; n.min = min; n.max = max; n.placeholder = ph; n.value = r[cle] || '';
        n.addEventListener('input', () => { r[cle] = Number(n.value) || 0; maj(); });
        return n;
      };
      grille.append(
        champ('Position', select('pos', r.pos, v => { r.pos = v; maj(); })),
        champ('Rôle', select('role', r.role, v => { r.role = v; maj(); })),
        champ('Style', select('style', r.style, v => { r.style = v; maj(); })),
        champ('Tir', select('tir', r.tir, v => { r.tir = v; maj(); })),
        champ('Overall minimum', nombre('ovMin', 40, 99, 'Ex. 80')),
        champ('Âge maximum', nombre('ageMax', 18, 45, 'Ex. 28')),
        champ('Contrat', select('contrat', r.contrat, v => { r.contrat = v; maj(); })),
      );
      const note = el('input', 'mc-note'); note.maxLength = M.MAX_NOTE; note.value = r.n || '';
      note.placeholder = 'Note (facultative) : ce que les critères ne disent pas';
      note.setAttribute('aria-label', 'Note');
      note.addEventListener('input', () => { r.n = note.value; resume.textContent = M.decrire(r); majBoutons(); });
      const liste = el('p', 'mc-match');
      carte.append(tete, grille, note, liste);
      correspondances(r, liste);
      return carte;
    }));
  }
  // Joueurs déjà sur le marché (autres équipes) qui répondent à cette recherche.
  function correspondances(r, cible){
    if(!ligue){ cible.textContent = ''; return; }
    const trouves = [];
    marche.forEach((e, c) => { if(c !== code) e.disponibles.forEach(d => { const j = ligue.get(d.j); if(j && j.equipe === c && M.correspond(j, r)) trouves.push(j); }); });
    trouves.sort((a, b) => b.ov - a.ov);
    cible.textContent = trouves.length ? 'Sur le marché en ce moment : ' + trouves.slice(0, 5).map(j => `${j.choix ? j.id : j.nom} (${j.equipe}${j.choix ? '' : ', ' + j.ov})`).join(', ') + (trouves.length > 5 ? ` et ${trouves.length - 5} autres` : '')
      : 'Aucun joueur disponible ne correspond pour l’instant.';
  }

  async function chargerEquipe(c){
    code = c;
    afficher('', false);
    $('zone').hidden = true;
    try{
      [roster, marche] = await Promise.all([M.chargerJoueurs([c]), M.chargerMarche()]);
    }catch(e){ afficher('Impossible de lire les joueurs de l’équipe pour le moment.', true); return; }
    const e = marche.get(c) || { posture: '', disponibles: [], recherches: [], note: '' };
    etat = { posture: e.posture || '', note: e.note || '', disponibles: e.disponibles.map(d => ({ j: d.j, n: d.n || '' })),
      recherches: e.recherches.map(r => ({ pos: r.pos || '', role: r.role || '', style: r.style || '', tir: r.tir || '', ovMin: Number(r.ovMin) || 0, ageMax: Number(r.ageMax) || 0, contrat: r.contrat || '', n: r.n || '' })) };
    initial = empreinte();
    $('note').value = etat.note;
    rendrePostures(); rendreDisponibles(); rendreRecherches();
    $('zone').hidden = false;
    majBoutons();
    // Correspondances : tous les joueurs de la ligue, chargés après l'affichage.
    if(!ligue) M.chargerJoueurs().then(l => { ligue = new Map(l.map(j => [j.id, j])); rendreRecherches(); }).catch(() => {});
  }

  async function enregistrer(){
    if(envoi || !etat) return;
    envoi = true; majBoutons();
    $('enregistrer').textContent = 'Enregistrement…';
    const corps = { equipe: code, posture: etat.posture, note: etat.note.trim(),
      disponibles: etat.disponibles.filter(d => roster.some(j => j.id === d.j)).map(d => ({ j: d.j, n: d.n.trim() })),
      recherches: etat.recherches.map(r => Object.assign({}, r, { n: r.n.trim() })) };
    const r = await api('/api/marche/sauver', corps);
    envoi = false;
    $('enregistrer').textContent = 'Enregistrer';
    if(r.ok){
      etat.disponibles = corps.disponibles;
      initial = empreinte();
      rendreDisponibles();
      afficher('Marché enregistré. Il paraîtra dans La Gazette LNHQ d’ici quelques secondes.', false);
    }else{
      afficher(r.erreur === 'joueur' ? `${M.prenomNom(r.joueur || '')} ne fait plus partie de l’équipe : recharge la page.` : ERREURS[r.erreur] || "L'enregistrement a échoué. Réessaie dans un instant.", true);
    }
    majBoutons();
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
    $('qui').textContent = 'Marché des échanges' + (sienne ? ' de ' + r.equipe : '') + (moi.admin ? ' · admin' : '');
    $('barre').hidden = false;
    let depart = sienne;
    if(moi.admin){
      const demande = (new URLSearchParams(location.search).get('equipe') || '').toUpperCase();
      const sel = $('equipe'), caseAdmin = $('modeAdmin');
      sel.replaceChildren(...Object.keys(EQUIPES).sort((a, b) => EQUIPES[a].localeCompare(EQUIPES[b], 'fr')).map(c => { const o = el('option', null, EQUIPES[c]); o.value = c; return o; }));
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
        if(!caseAdmin.checked && !aller(sienne)){ caseAdmin.checked = true; return; }
        sel.hidden = !caseAdmin.checked;
        sel.value = code;
      });
    }
    $('note').addEventListener('input', () => { etat.note = $('note').value; majBoutons(); });
    $('ajouter').addEventListener('click', () => {
      if(etat.recherches.length >= M.MAX_RECHERCHES) return;
      etat.recherches.push({ pos: '', role: '', style: '', tir: '', ovMin: 0, ageMax: 0, contrat: '', n: '' });
      rendreRecherches(); changer();
    });
    $('enregistrer').addEventListener('click', enregistrer);
    $('annuler').addEventListener('click', () => chargerEquipe(code));
    window.addEventListener('beforeunload', ev => { if(modifie()){ ev.preventDefault(); ev.returnValue = ''; } });
    await chargerEquipe(depart);
  }

  demarrer();
})();
