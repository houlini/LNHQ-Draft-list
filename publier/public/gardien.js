/* LNHQ — déclaration du 2e gardien (publier.lnhq.ca, derrière Cloudflare Access).
   L'équipe vient de la liste d'accès ; le script revérifie le match et le verrou. */
(function(){
  const $ = id => document.getElementById(id);
  const G = window.LNHQ_GARDIENS;
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
    periode_terminee: 'Cette période est terminée : elle est verrouillée.',
  };
  const court = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short' });
  const jourCourt = new Intl.DateTimeFormat('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
  const date = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  let code = '';
  let matchs = [];
  let decl = {};
  let ouvertes = null;   // périodes ouvertes par le lecteur (gardé aux mises à jour)
  let envoi = false;

  function el(tag, cls, text){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    return e;
  }
  function afficher(texte, erreur){
    const m = $('message');
    m.className = 'gar-message ' + (erreur ? 'is-erreur' : 'is-ok');
    m.textContent = texte;
    m.hidden = false;
  }
  async function api(chemin, corps){
    try{
      const rep = await fetch(chemin, corps ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) } : undefined);
      return await rep.json();
    }catch(e){ return { ok: false, erreur: 'session' }; }
  }

  function render(){
    const auj = G.aujourdhui();
    const mesMatchs = matchs.filter(m => m.codeVisiteur === code || m.codeDomicile === code);
    const periodes = G.periodes(matchs);
    const courante = (periodes.find(p => p.fin >= auj) || periodes[periodes.length - 1] || {}).num;
    if(!ouvertes) ouvertes = new Set([courante]);

    $('periodes').replaceChildren(...periodes.map(p => {
      const d = decl[code + '|' + p.num];
      const terminee = p.fin < auj;
      const etat = d ? 'is-fait' : terminee ? 'is-illegal' : 'is-a-faire';
      const bloc = el('details', 'gar-periode ' + etat + (p.num === courante ? ' is-courante' : ''));
      bloc.id = 'p-' + p.num;
      bloc.open = ouvertes.has(p.num);
      bloc.addEventListener('toggle', () => { bloc.open ? ouvertes.add(p.num) : ouvertes.delete(p.num); });
      const tete = el('summary', 'gar-tete');
      tete.append(el('strong', null, 'Période ' + p.num + (p.num === courante ? ' · en cours' : '')),
        el('span', 'gar-dates', court.format(date(p.debut)) + ' au ' + court.format(date(p.fin))),
        el('span', 'gar-etat', d ? `✅ ${court.format(date(d.date))} vs ${d.adversaire}` : terminee ? '❌ Illégale' : '⏳ À choisir'));
      bloc.append(tete);

      const liste = el('ul', 'gar-matchs');
      mesMatchs.filter(m => m.periode === p.num).forEach(m => {
        const domicile = m.codeDomicile === code;
        const adv = domicile ? m.codeVisiteur : m.codeDomicile;
        const choisi = d && d.match === m.num;
        const li = el('li', 'gar-match' + (choisi ? ' is-choisi' : ''));
        const advEl = el('span', 'gar-adv');
        const img = el('img');
        img.src = 'https://lnhq.ca/Logos/' + adv + '.png';
        img.alt = '';
        advEl.append(img, el('span', null, (domicile ? 'vs ' : '@ ') + (domicile ? m.visiteur : m.domicile)));
        li.append(el('span', 'gar-quand', jourCourt.format(date(m.date))), advEl);
        if(!terminee){
          const b = el('button', 'gar-bouton' + (choisi ? ' is-choisi' : ''), choisi ? '✓ 2e gardien' : 'Choisir');
          b.type = 'button';
          b.title = choisi ? 'Retirer ce choix' : 'Mon 2e gardien joue ce match';
          b.addEventListener('click', () => choisi ? retirer(p.num, b) : declarer(m, b));
          li.append(b);
        }else if(choisi){
          li.append(el('span', 'gar-bouton is-choisi', '✓ 2e gardien'));
        }
        liste.append(li);
      });
      bloc.append(liste);
      return bloc;
    }));
  }

  async function recharger(){
    decl = await G.chargerDeclarations();
    render();
  }

  async function declarer(m, bouton){
    if(envoi) return;
    envoi = true;
    bouton.disabled = true;
    const r = await api('/api/gardien/declarer', { match: m.num });
    envoi = false;
    if(r.ok){
      afficher(`Période ${r.periode} : c'est noté, 2e gardien le ${court.format(date(m.date))}`, false);
      // Le classeur public met quelques secondes à refléter l'écriture : on met l'affichage à jour tout de suite.
      decl[code + '|' + r.periode] = { equipe: code, periode: r.periode, match: m.num, date: m.date,
        adversaire: m.codeDomicile === code ? m.codeVisiteur : m.codeDomicile };
      render();
    }else{
      afficher(ERREURS[r.erreur] || "L'enregistrement a échoué. Réessaie dans un instant.", true);
      await recharger();
    }
  }

  async function retirer(periode, bouton){
    if(envoi || !confirm(`Retirer ton choix pour la période ${periode} ?`)) return;
    envoi = true;
    bouton.disabled = true;
    const r = await api('/api/gardien/retirer', { periode });
    envoi = false;
    if(r.ok){
      afficher(`Choix retiré pour la période ${periode}.`, false);
      delete decl[code + '|' + periode];
      render();
    }else{
      afficher(ERREURS[r.erreur] || 'Le retrait a échoué.', true);
      await recharger();
    }
  }

  async function demarrer(){
    const moi = await api('/api/moi');
    if(!moi.ok || !CODES[moi.equipe]){
      $('qui').textContent = '';
      $('refusTexte').textContent = !moi.ok ? (ERREURS[moi.erreur] || 'Accès impossible pour le moment.') : ERREURS.equipe;
      $('refus').hidden = false;
      return;
    }
    code = CODES[moi.equipe];
    $('qui').textContent = '2e gardien de ' + moi.equipe;
    $('intro').hidden = false;
    try{
      [matchs, decl] = await Promise.all([G.chargerCalendrier(), G.chargerDeclarations()]);
    }catch(e){
      afficher('Impossible de lire le calendrier pour le moment.', true);
      return;
    }
    render();
    const courante = document.querySelector('.gar-periode.is-courante');
    if(courante) courante.scrollIntoView({ block: 'start' });
  }

  demarrer();
})();
