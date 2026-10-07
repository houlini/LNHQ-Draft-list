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
    deja_egalite: 'Tu as déjà misé le maximum sur cette enchère (égalité).',
    maximum: 'Mise trop haute : le maximum est de 1000 jetons.',
    pas_ouvert: 'Les enchères ne sont pas encore ouvertes.',
    admin: 'Seuls les admins de la ligue peuvent faire le tirage.',
    pas_tirage: 'Cette enchère n’attend plus de tirage.',
    heure: 'Choisis une heure dans le futur (au moins 1 minute).',
  };
  const quand = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  // Arrivée par « Surenchérir » sur lnhq.ca (?id=…) : on affiche seulement cette enchère.
  let cibleId = new URLSearchParams(location.search).get('id') || '';

  let moi = null;          // { equipe, code, admin }
  let donnees = null;
  let agents = [];
  let envoiEnCours = false;
  let barre = null;        // filtres position / équipe (E.barreFiltres)

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
  const MAX = () => E.REGLES.miseMaximale;

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
    if(r.erreur === 'maximum' && r.maximum) t = `Mise trop haute : le maximum est de ${r.maximum} jetons.`;
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
    tete.append(nomJoueur(e.joueur), el('span', null, [e.position, e.ov && e.ov + ' OV'].filter(Boolean).join(' · ')));

    const meneur = el('div', 'ench-meneur');
    const qui = el('div', 'ench-qui');
    qui.append(el('span', 'ench-etiquette', e.egalite.length ? 'À égalité' : 'En tête'), el('strong', null, nomEquipe(e.equipe)));
    const montant = el('div', 'ench-montant');
    montant.append(el('strong', null, e.mise), el('span', null, 'jetons'));
    meneur.append(logo(e.equipe), qui, montant);

    const chrono = el('div', 'ench-chrono');
    const reste = el('strong', 'ench-reste');
    reste.dataset.fin = e.fin;
    reste.textContent = E.tempsRestant(e.fin);
    chrono.append(el('span', null, e.egalite.length ? 'Tirage dans' : 'Fin dans'), reste, el('span', 'ench-fin', quand.format(new Date(e.fin))));

    const minimum = E.minimum(e);
    const auMax = e.mise >= MAX();
    const zone = el('div');
    if(!moi.code){
      zone.append(el('span', 'mise-note', 'Mode admin : seules les équipes misent.'));
    }else if(e.equipe === moi.code){
      zone.append(el('span', 'mise-note', auMax ? `✓ Tu as misé le maximum (${MAX()}).` : '✓ Tu es en tête de cette enchère.'));
    }else if(e.egalite.includes(moi.code)){
      zone.append(el('span', 'mise-note', `✓ Tu es à égalité à ${MAX()} : tirage au sort à la fin.`));
    }else if(auMax){
      // Déjà au maximum : on peut seulement égaler (sans relancer le chrono).
      const bouton = el('button', 'ench-bouton', `Égaler à ${MAX()}`);
      bouton.type = 'button';
      if(mesJetons() < MAX()){ bouton.disabled = true; bouton.title = 'Pas assez de jetons disponibles'; }
      bouton.addEventListener('click', () => miser(e, MAX(), bouton));
      zone.append(bouton);
    }else{
      const form = el('form', 'mise-carte');
      form.noValidate = true;
      const champ = el('input');
      champ.type = 'number';
      champ.inputMode = 'numeric';
      champ.min = String(minimum);
      champ.max = String(MAX());
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
    pied.append(el('span', null, `${e.nb} mise${e.nb > 1 ? 's' : ''} · ` + (auMax
      ? `maximum atteint : on peut égaler à ${MAX()} (le chrono ne repart pas)`
      : minimum >= MAX() ? `prochaine mise : ${MAX()} (maximum)` : `minimum ${minimum} jetons · maximum ${MAX()}`)));
    c.append(tete, meneur);
    if(e.egalite.length) c.append(equipesEgalite('Aussi à ' + MAX(), e.egalite));
    c.append(chrono, zone, pied);
    return c;
  }

  function equipesEgalite(etiquette, codes){
    const ligne = el('div', 'ench-egalite');
    ligne.append(el('span', 'ench-etiquette', etiquette));
    codes.forEach(code => { const t = el('span', 'ench-egalite-equipe'); t.append(logo(code), nomEquipe(code)); ligne.append(t); });
    return ligne;
  }

  // Enchère terminée à égalité : bouton « Tirer au sort » pour les admins.
  function carteTirage(e){
    const c = el('article', 'ench-carte is-tirage');
    c.id = 'e-' + e.id;
    const tete = el('div', 'ench-joueur');
    tete.append(nomJoueur(e.joueur), el('span', null, [e.position, e.ov && e.ov + ' OV'].filter(Boolean).join(' · ')));
    const candidats = [e.equipe, ...e.egalite];
    const zone = el('div', 'mise-tirage');
    const prevu = e.tiragePrevu ? new Date(e.tiragePrevu) : null;
    zone.append(el('span', 'mise-note', prevu
      ? `📅 Tirage en direct sur lnhq.ca : ${quandLong.format(prevu)} (dans ${E.tempsRestant(e.tiragePrevu)})`
      : 'Heure du tirage à venir : la ligue la programme.'));
    // Admin : programme (ou change) l'heure ; le tirage se fait tout seul à l'heure, en direct.
    if(moi.admin){
      const form = el('form', 'mise-carte');
      form.noValidate = true;
      const champ = el('input');
      champ.type = 'datetime-local';
      champ.setAttribute('aria-label', 'Heure du tirage au sort');
      champ.value = versChamp(prevu || heureParDefaut());
      const bouton = el('button', 'ench-bouton', prevu ? 'Changer l’heure' : '📅 Programmer le tirage');
      bouton.type = 'submit';
      form.append(champ, bouton);
      form.addEventListener('submit', ev => { ev.preventDefault(); programmer(e, candidats, champ.value, bouton); });
      zone.append(form);
    }
    c.append(tete, el('div', 'ench-tirage-titre', `Égalité à ${e.mise} jetons`), equipesEgalite('Au tirage', candidats), zone);
    return c;
  }

  // Champ datetime-local (heure de l'ordinateur) ; par défaut : la prochaine demi-heure, dans 30 min au moins.
  const quandLong = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  function heureParDefaut(){
    const d = new Date(Date.now() + 30 * 60000);
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
    return d;
  }
  function versChamp(d){
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
  }

  // Joueurs sans contrat LNH (contrat fictif LNHQ) : nom en rouge avec « * ».
  let sansContrat = { cles: new Set() };
  if(window.LNHQ_SANS_CONTRAT) LNHQ_SANS_CONTRAT.charger().then(sc => { sansContrat = sc; if(donnees) render(); });
  const estSansContrat = nom => !!window.LNHQ_SANS_CONTRAT && sansContrat.cles.has(LNHQ_SANS_CONTRAT.cle(nom));
  function nomJoueur(nom){
    const s = el('strong', null, nom);
    if(estSansContrat(nom)) LNHQ_SANS_CONTRAT.marquer(s);
    return s;
  }

  function render(){
    const dispo = moi.code ? mesJetons() : null;
    $('jetonsMoi').textContent = dispo != null ? dispo : '';
    $('blocJetons').hidden = dispo == null;
    if(moi.code && !$('logoMoi').src) $('logoMoi').src = 'https://lnhq.ca/Logos/' + moi.code + '.png';
    // Enchère visée par « Surenchérir » : seule en haut de la page. Terminée entre-temps :
    // on le dit et on revient à la page complète.
    let cible = null;
    if(cibleId){
      cible = donnees.encheres.find(e => e.id === cibleId && (e.statut === 'En cours' || e.statut === 'Tirage')) || null;
      if(!cible){
        const e = donnees.encheres.find(x => x.id === cibleId);
        afficher(e ? `L’enchère sur ${e.joueur} est terminée.` : 'Cette enchère est introuvable ou terminée.', true);
        quitterCible();
      }
    }
    $('blocCible').hidden = !cible;
    $('cible').replaceChildren(...(cible ? [cible.statut === 'Tirage' ? carteTirage(cible) : carte(cible)] : []));
    // Avant l'ouverture (décompte affiché), admin sans équipe ou surenchère : pas de lancement.
    $('blocLancer').hidden = !E.ouvert() || !moi.code || !!cible;
    const tirages = donnees.encheres.filter(e => e.statut === 'Tirage' && e !== cible);
    $('tirages').replaceChildren(...tirages.map(carteTirage));
    $('blocTirages').hidden = !tirages.length || !!cible;
    $('compteTirages').textContent = tirages.length ? '(' + tirages.length + ')' : '';
    const enCours = donnees.encheres.filter(e => e.statut === 'En cours').sort((a, b) => new Date(a.fin) - new Date(b.fin));
    // Filtres position / équipe (au-dessus de la grille).
    barre.majEquipes(enCours, nomEquipe);
    const filtre = !!(barre.filtres.position || barre.filtres.equipe);
    const autres = enCours.filter(e => e !== cible && E.correspond(e, barre.filtres));
    $('enCours').replaceChildren(...autres.map(carte));
    $('blocEnCours').hidden = !!cible;
    $('aucuneEnCours').hidden = !!autres.length;
    $('aucuneEnCours').textContent = filtre && enCours.length ? 'Aucune enchère pour ces filtres.' : 'Aucune enchère en cours.';
    $('compteEnCours').textContent = !enCours.length ? '' : filtre ? `(${autres.length} sur ${enCours.length})` : '(' + enCours.length + ')';

    // Liste des agents libres, sans ceux déjà en enchère.
    const occupes = new Set(enCours.map(e => e.joueur + '|' + e.naissance));
    $('listeJoueurs').replaceChildren(...agents.filter(j => !occupes.has(j.nom + '|' + j.naissance)).map(j => {
      const o = el('option');
      o.value = j.nom;
      o.label = [j.position, j.ov && j.ov + ' OV', j.age && j.age + ' ans', estSansContrat(j.nom) && '* sans contrat LNH'].filter(Boolean).join(' · ');
      return o;
    }));
    $('montantLancer').max = String(Math.min(MAX(), Math.max(E.REGLES.miseMinimale, dispo || 0)));
    $('aideLancer').textContent = agents.length
      ? `${agents.length} agents libres. Mise de départ : ${E.REGLES.miseMinimale} à ${MAX()} jetons. Le chrono démarre à 24 h.`
      : "Aucun agent libre pour l'instant (colonne LNHQ TM = UFA dans PLAYERSDATABASE).";
  }

  // Retour à la page complète (toutes les enchères, formulaire de lancement).
  function quitterCible(){
    cibleId = '';
    history.replaceState(null, '', location.pathname);
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
    if(montant > MAX()){ afficher(`Mise trop haute : le maximum est de ${MAX()} jetons.`, true); return; }
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
    const minimum = E.minimum(e);
    if(!(montant >= minimum)){ afficher(`Mise trop basse : minimum ${minimum} jetons.`, true); return; }
    if(montant > MAX()){ afficher(`Mise trop haute : le maximum est de ${MAX()} jetons.`, true); return; }
    const egaler = e.mise >= MAX();
    if(!confirm(egaler
      ? `Égaler à ${MAX()} jetons sur ${e.joueur} ? Tes ${MAX()} jetons restent bloqués jusqu'au tirage au sort.`
      : `Miser ${montant} jetons sur ${e.joueur} ?`)) return;
    envoiEnCours = true;
    bouton.disabled = true;
    const r = await api('/api/encheres/miser', { id: e.id, montant });
    envoiEnCours = false;
    if(r.ok) afficher((r.egalite ? `Tu es à égalité à ${montant} jetons sur ${e.joueur} : tirage au sort à la fin.` : `Tu es en tête sur ${e.joueur} avec ${montant} jetons.`)
      + (r.discord === false ? ' (Annonce Discord non envoyée.)' : ''), false);
    else afficher(texteErreur(r), true);
    await recharger();
  }

  async function programmer(e, candidats, valeur, bouton){
    if(envoiEnCours) return;
    const quand = new Date(valeur);
    if(isNaN(quand.getTime()) || quand.getTime() < Date.now() + 60000){ afficher('Choisis une heure dans le futur (au moins 1 minute).', true); return; }
    if(!confirm(`Programmer le tirage de ${e.joueur} (${candidats.map(nomEquipe).join(', ')}) pour ${quandLong.format(quand)} ?\n`
      + 'Il se fera tout seul à l’heure, en direct sur la page des enchères, et sera annoncé sur Discord.')) return;
    envoiEnCours = true;
    bouton.disabled = true;
    const r = await api('/api/encheres/programmer', { id: e.id, quand: quand.toISOString() });
    envoiEnCours = false;
    if(r.ok) afficher(`📅 Tirage programmé pour ${quandLong.format(quand)}.` + (r.discord === false ? ' (Annonce Discord non envoyée.)' : ''), false);
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
    moi = { equipe: r.equipe, code: CODES[r.equipe] || '', admin: r.annonces === true };
    // Sans équipe : seulement les admins (pour les tirages au sort).
    if(!moi.code && !moi.admin){
      $('qui').textContent = 'Connecté au nom de la ligue';
      $('refusTexte').textContent = ERREURS.equipe;
      $('refus').hidden = false;
      return;
    }
    $('qui').textContent = (moi.code ? 'Tu mises pour ' + moi.equipe : 'Admin de la ligue') + (moi.code && moi.admin ? ' · admin' : '');
    $('formLancer').addEventListener('submit', lancer);
    barre = E.barreFiltres($('filtres'), () => { if(donnees) render(); });
    $('voirTout').addEventListener('click', () => { quitterCible(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('contenu').hidden = false;
    // Avant l'ouverture : décompte au-dessus du contenu (disparaît à l'heure).
    E.decompte($('contenu'), () => recharger());
    await recharger();
    setInterval(() => document.querySelectorAll('.ench-reste').forEach(s => { s.textContent = E.tempsRestant(s.dataset.fin); }), 1000);
    // Données fraîches chaque minute, sauf pendant qu'on tape une mise.
    setInterval(() => {
      if(!document.hidden && !envoiEnCours && !(document.activeElement && document.activeElement.tagName === 'INPUT')) recharger();
    }, 60 * 1000);
  }

  demarrer();
})();
