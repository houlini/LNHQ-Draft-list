/* LNHQ — soumission du résultat d'un match (publier.lnhq.ca, derrière Cloudflare Access).
   La photo est lue par Gemini (via le Worker) pour préremplir le formulaire ; le DG
   vérifie, puis le script enregistre la photo, la ligne RESULTATS et le score. */
(function(){
  const $ = id => document.getElementById(id);
  const G = window.LNHQ_GARDIENS;
  const R = window.LNHQ_RESULTATS;
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
    equipe: "Ton courriel n'est lié à aucune équipe.",
    match: "Ce match n'est pas un match de ton équipe.",
    pas_joue: "Ce match est prévu après la semaine en cours : il ne peut pas encore être soumis.",
    score: 'Le score est invalide (pas de match nul).',
    fin: 'Une prolongation ou des tirs de barrage se terminent par un seul but d’écart.',
    photo: 'La photo n’est pas valide (JPEG, PNG ou WebP, 5 Mo maximum).',
    deja_soumis: 'Le résultat de ce match a déjà été soumis. Pour une correction, contacte un admin.',
    taille: 'La photo est trop lourde.',
  };
  const LECTURE = {
    lecture_indisponible: "La lecture automatique n'est pas encore activée : remplis les valeurs à la main.",
    quota: 'La lecture automatique a atteint sa limite pour aujourd’hui : remplis les valeurs à la main.',
  };
  const jourCourt = new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
  const date = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const logo = c => 'https://lnhq.ca/Logos/' + c + '.png';

  let moi = null;          // { equipe, code, admin }
  let matchs = [];
  let resultats = {};
  let photo = null;        // { mime, data } (JPEG réduit)
  let envoi = false;

  function el(tag, cls, text){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    return e;
  }
  function afficher(texte, erreur){
    const m = $('message');
    m.className = 'res-message ' + (erreur ? 'is-erreur' : 'is-ok');
    m.textContent = texte;
    m.hidden = false;
    m.scrollIntoView({ block: 'nearest' });
  }
  async function api(chemin, corps){
    try{
      const rep = await fetch(chemin, corps ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) } : undefined);
      return await rep.json();
    }catch(e){ return { ok: false, erreur: 'session' }; }
  }

  const matchChoisi = () => matchs.find(m => m.num === $('match').value);

  // Par défaut : ses matchs déjà joués et sans résultat. Mode admin (case à cocher) :
  // tous les matchs joués, y compris ceux déjà soumis (correction).
  const modeAdmin = () => moi.admin && $('modeAdmin').checked;
  // Dernier jour soumettable : le dimanche de la semaine en cours (semaines du calendrier,
  // du lundi au dimanche). Les matchs de la semaine peuvent être joués d'avance.
  function finSemaine(){
    const d = date(G.aujourdhui());
    d.setDate(d.getDate() + (7 - d.getDay()) % 7);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function remplirMatchs(){
    const limite = finSemaine();
    const tous = modeAdmin();
    const liste = matchs.filter(m => m.date <= limite
      && (tous || ((m.codeVisiteur === moi.code || m.codeDomicile === moi.code) && !resultats[m.num])))
      .sort((a, b) => b.date.localeCompare(a.date) || Number(b.num) - Number(a.num));
    const choix = [el('option', null, liste.length ? 'Choisis le match…' : 'Aucun match à soumettre pour l’instant')];
    choix[0].value = '';
    liste.forEach(m => {
      const o = el('option', null, `${jourCourt.format(date(m.date))} · ${m.codeVisiteur} @ ${m.codeDomicile}${resultats[m.num] ? ' ✓ soumis' : ''}`);
      o.value = m.num;
      choix.push(o);
    });
    $('match').replaceChildren(...choix);
  }

  function construireStats(){
    $('stats').replaceChildren(...R.STATS.map(s => {
      const tr = el('tr');
      const v = el('input'); v.id = 'sv-' + s.cle; v.setAttribute('aria-label', s.nom + ' visiteur');
      const d = el('input'); d.id = 'sd-' + s.cle; d.setAttribute('aria-label', s.nom + ' domicile');
      const tdV = el('td'); tdV.append(v);
      const tdD = el('td'); tdD.append(d);
      tr.append(tdV, el('th', null, s.nom), tdD);
      return tr;
    }));
  }

  function viderValeurs(){
    ['butsV', 'butsD'].forEach(id => { $(id).value = ''; });
    $('fin').value = '';
    R.STATS.forEach(s => { $('sv-' + s.cle).value = ''; $('sd-' + s.cle).value = ''; });
  }

  function choisirMatch(){
    const m = matchChoisi();
    photo = null;
    $('photo').value = '';
    $('apercu').hidden = true;
    $('photoTexte').textContent = 'Prendre ou choisir une photo';
    $('lecture').hidden = true;
    viderValeurs();
    $('blocValeurs').hidden = !m;
    if(m){
      $('codeV').textContent = $('teteV').textContent = m.codeVisiteur;
      $('codeD').textContent = $('teteD').textContent = m.codeDomicile;
      $('logoV').src = logo(m.codeVisiteur);
      $('logoD').src = logo(m.codeDomicile);
      // Correction par un admin : on part du résultat déjà enregistré.
      const r = resultats[m.num];
      if(r){
        $('butsV').value = r.butsV; $('butsD').value = r.butsD; $('fin').value = r.fin || '';
        R.STATS.forEach(s => { const p = (r.stats && r.stats[s.cle]) || ['', '']; $('sv-' + s.cle).value = p[0]; $('sd-' + s.cle).value = p[1]; });
        $('lecture').className = 'res-aide';
        $('lecture').textContent = 'Résultat déjà enregistré : modifie les valeurs ou ajoute une nouvelle photo.';
        $('lecture').hidden = false;
      }else if(!modeAdmin()){
        verifierDejaSoumis(m);
      }
    }
    majBouton();
  }

  // Le résultat a peut-être été soumis par l'autre DG depuis l'ouverture de la page :
  // on relit les résultats dès le choix du match pour avertir avant la photo.
  async function verifierDejaSoumis(m){
    let frais;
    try{ frais = await R.chargerResultats(); }catch(e){ return; }
    if(!frais[m.num]) return;
    resultats = Object.assign(resultats, frais);
    if(matchChoisi() !== m) return;
    dejaSoumis(m);
  }

  function dejaSoumis(m){
    afficher(`Le résultat de ${m.codeVisiteur} @ ${m.codeDomicile} (${jourCourt.format(date(m.date))}) vient d’être soumis par l’autre DG. Pour une correction, contacte un admin.`, true);
    remplirMatchs();
    choisirMatch();
  }

  function majBouton(){
    const m = matchChoisi();
    // Photo facultative : un résultat peut être entré à la main (score obligatoire).
    $('envoyer').disabled = envoi || !m || $('butsV').value === '' || $('butsD').value === '';
  }

  // Photo réduite à 1600 px (plus légère à envoyer et assez nette pour la lecture).
  function reduire(fichier){
    return new Promise((ok, echec) => {
      const url = URL.createObjectURL(fichier);
      const img = new Image();
      img.onload = () => {
        const echelle = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * echelle);
        c.height = Math.round(img.naturalHeight * echelle);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const dataUrl = c.toDataURL('image/jpeg', 0.85);
        ok({ mime: 'image/jpeg', data: dataUrl.split(',')[1], dataUrl });
      };
      img.onerror = () => { URL.revokeObjectURL(url); echec(new Error('image')); };
      img.src = url;
    });
  }

  async function choisirPhoto(){
    const fichier = $('photo').files[0];
    if(!fichier) return;
    const m = matchChoisi();
    try{ photo = await reduire(fichier); }
    catch(e){ photo = null; afficher('Cette image ne peut pas être lue. Essaie une autre photo.', true); majBouton(); return; }
    $('apercu').src = photo.dataUrl;
    $('apercu').hidden = false;
    $('photoTexte').textContent = 'Changer la photo';
    majBouton();
    if(!m) return;

    const lecture = $('lecture');
    lecture.className = 'res-aide is-attente';
    lecture.textContent = 'Lecture de la photo…';
    lecture.hidden = false;
    const r = await api('/api/resultat/lire', { mime: photo.mime, data: photo.data });
    if(matchChoisi() !== m) return;   // le DG a changé de match entre-temps
    if(!r.ok || !r.lecture || !r.lecture.lisible){
      lecture.className = 'res-aide is-erreur';
      lecture.textContent = LECTURE[r.erreur] || "La photo n'a pas pu être lue : vérifie qu'elle montre l'écran de fin de match, ou remplis les valeurs à la main.";
      return;
    }
    appliquerLecture(m, r.lecture);
  }

  // Gauche/droite de l'écran → visiteur/domicile, d'après les codes lus.
  function appliquerLecture(m, l){
    const g = l.gauche || {}, d = l.droite || {};
    const cg = String(g.code || '').toUpperCase(), cd = String(d.code || '').toUpperCase();
    const inverse = cg === m.codeDomicile || cd === m.codeVisiteur;
    const [v, dom] = inverse ? [d, g] : [g, d];
    const reconnu = [cg, cd].sort().join() === [m.codeVisiteur, m.codeDomicile].sort().join();
    if(Number.isInteger(v.buts)) $('butsV').value = v.buts;
    if(Number.isInteger(dom.buts)) $('butsD').value = dom.buts;
    $('fin').value = l.fin === 'PROL' || l.fin === 'TB' ? l.fin : '';
    R.STATS.forEach(s => { $('sv-' + s.cle).value = v[s.cle] || ''; $('sd-' + s.cle).value = dom[s.cle] || ''; });
    const lecture = $('lecture');
    if(reconnu){
      lecture.className = 'res-aide is-ok';
      lecture.textContent = 'Photo lue. Vérifie les valeurs avant d’envoyer.';
    }else{
      lecture.className = 'res-aide is-erreur';
      lecture.textContent = `Attention : la photo semble montrer ${cg || '?'} contre ${cd || '?'}, mais le match choisi est ${m.codeVisiteur} @ ${m.codeDomicile}. Vérifie le match et les valeurs.`;
    }
    majBouton();
  }

  async function envoyer(ev){
    ev.preventDefault();
    const m = matchChoisi();
    if(envoi || !m) return;
    const stats = {};
    R.STATS.forEach(s => { stats[s.cle] = [$('sv-' + s.cle).value.trim(), $('sd-' + s.cle).value.trim()]; });
    const corps = { match: m.num, butsV: Number($('butsV').value), butsD: Number($('butsD').value), fin: $('fin').value, stats,
      photo: photo ? { mime: photo.mime, data: photo.data } : null };
    envoi = true;
    majBouton();
    $('envoyer').textContent = 'Envoi…';
    const r = await api('/api/resultat/soumettre', corps);
    envoi = false;
    $('envoyer').textContent = 'Envoyer le résultat';
    if(r.ok){
      afficher(`${r.correction ? 'Résultat corrigé' : 'Résultat enregistré'} : ${m.codeVisiteur} ${corps.butsV} – ${corps.butsD} ${m.codeDomicile}. Il apparaîtra dans le calendrier et le classement d’ici quelques secondes.`, false);
      // Le classeur public met quelques secondes à refléter l'écriture.
      resultats[m.num] = { butsV: corps.butsV, butsD: corps.butsD, fin: corps.fin, stats };
      remplirMatchs();
      choisirMatch();
    }else if(r.erreur === 'deja_soumis'){
      // Soumis entre-temps par l'autre DG : le match sort de la liste.
      try{ resultats = Object.assign(resultats, await R.chargerResultats()); }catch(e){}
      if(!resultats[m.num]) resultats[m.num] = { butsV: '', butsD: '', fin: '', stats: null };
      dejaSoumis(m);
    }else{
      afficher(ERREURS[r.erreur] || "L'enregistrement a échoué. Réessaie dans un instant.", true);
      majBouton();
    }
  }

  async function demarrer(){
    const r = await api('/api/moi');
    const code = r.ok ? (CODES[r.equipe] || '') : '';
    if(!r.ok || (!code && !r.annonces)){
      $('qui').textContent = '';
      $('refusTexte').textContent = !r.ok ? (ERREURS[r.erreur] || 'Accès impossible pour le moment.') : ERREURS.equipe;
      $('refus').hidden = false;
      return;
    }
    moi = { equipe: r.equipe, code, admin: r.annonces === true };
    $('qui').textContent = code ? 'Résultats de ' + r.equipe + (moi.admin ? ' · admin' : '') : 'Admin de la ligue';
    try{
      [matchs, resultats] = await Promise.all([G.chargerCalendrier(), R.chargerResultats()]);
    }catch(e){
      afficher('Impossible de lire le calendrier pour le moment.', true);
      return;
    }
    construireStats();
    // Admin sans équipe (compte « Ligue ») : seulement le mode admin.
    $('blocAdmin').hidden = !moi.admin;
    $('modeAdmin').checked = moi.admin && !code;
    $('modeAdmin').disabled = moi.admin && !code;
    $('modeAdmin').addEventListener('change', () => { remplirMatchs(); choisirMatch(); });
    remplirMatchs();
    $('formulaire').hidden = false;
    $('match').addEventListener('change', choisirMatch);
    $('photo').addEventListener('change', choisirPhoto);
    ['butsV', 'butsD'].forEach(id => $(id).addEventListener('input', majBouton));
    $('formulaire').addEventListener('submit', envoyer);
  }

  demarrer();
})();
