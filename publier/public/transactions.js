/* LNHQ — transactions entre équipes (publier.lnhq.ca/transactions.html, derrière Cloudflare Access).
   Un DG compose une offre avec 1 ou 2 autres équipes en touchant les cartes (joueurs, espoirs,
   choix) ; les autres DG acceptent, refusent ou font une contre-offre ; un dirigeant approuve.
   Le bilan (masse, plafond, plancher, 28 joueurs) est calculé ici pour guider ; le script le
   recalcule avec les données du moment à chaque étape et fait foi. */
(function(){
  const $ = id => document.getElementById(id);
  const A = window.LNHQ_ALIGNEMENT;
  const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';
  const GID_MASSE = '900003016';
  const MAX_JOUEURS = 28;

  // Code → [nom dans l'onglet ACCES, slug de lnhq.ca/equipe.html] (comme alignement-dg.js).
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
  const nom = c => (EQUIPES[c] || [c])[0];
  const codeDe = n => Object.keys(EQUIPES).find(c => EQUIPES[c][0] === n) || '';

  // Bande et accents de la page aux couleurs de l'équipe du DG (comme la page Équipe).
  function couleursPage(c){
    const [primaire, foncee] = COULEURS[c] || [];
    if(!primaire) return;
    const racine = document.documentElement.style;
    const sombre = matchMedia('(prefers-color-scheme: dark)').matches;
    racine.setProperty('--accent', primaire);
    racine.setProperty('--accent-ink', texteSur(primaire));
    racine.setProperty('--accent-soft', sombre ? assombrir(primaire, 0.75) : eclaircir(primaire, 0.85));
    racine.setProperty('--nav-dark', foncee);
    racine.setProperty('--nav-ink', texteSur(foncee));
  }
  // Variables des cartes d'alignement (--al-couleur, --al-sombre) et couleur d'équipe (--tx-couleur).
  function couleursEquipe(elem, c){
    const [primaire, foncee] = COULEURS[c] || ['#E8590C', '#1b1f24'];
    elem.style.setProperty('--al-couleur', primaire);
    elem.style.setProperty('--al-sombre', assombrir(foncee, 0.35));
    elem.style.setProperty('--tx-couleur', primaire);
  }

  const ERREURS = {
    acces: 'Accès refusé : ta session de connexion n’est plus valide. Recharge la page.',
    session: 'Ta session a peut-être expiré. Recharge la page pour te reconnecter.',
    inconnu: "Ton courriel n'est pas dans la liste d'accès de la ligue.",
    equipe: "Ton courriel n'est lié à aucune équipe : seuls les DG font des transactions.",
    equipes: 'Une transaction se fait entre 2 ou 3 équipes, dont la tienne.',
    mouvement: 'Un élément de l’offre est mal placé : recharge la page.',
    vide: 'Ajoute au moins un joueur, un espoir ou un choix à l’offre.',
    trop: 'Trop d’éléments dans une même offre (24 au maximum).',
    contre_offre: 'Cette offre ne peut plus recevoir de contre-offre (elle a changé entre-temps).',
    introuvable: 'Transaction introuvable : elle a peut-être changé entre-temps.',
    expiree: 'Cette offre a expiré (48 h sans réponse).',
    deja: 'Tu as déjà accepté cette offre.',
    admin: 'Seul un dirigeant peut approuver une transaction.',
  };
  const STATUTS = {
    'En attente': 'attente', 'À approuver': 'approbation', 'Approuvée': 'approuvee', 'Refusée': 'refusee',
    'Rejetée': 'refusee', 'Annulée': 'fermee', 'Expirée': 'fermee', 'Contre-offre': 'fermee',
  };
  const OUVERTS = ['En attente', 'À approuver'];

  let moi = null;            // { code, nom, admin }
  let vue = '';
  let liste = [];            // transactions visibles (du script)
  const effectifs = new Map();   // code → éléments (joueurs, espoirs, choix)
  let masses = {};           // code → { masse, plafond, plancher, joueurs }
  let ids = new Map();       // « Nom, Prénom » → numéro LNH (photos)
  // Offre en cours : équipes (la mienne d'abord) et éléments choisis (« joueur|de » → équipe qui reçoit).
  const offre = { equipes: [], choix: new Map(), message: '', remplace: null };
  let modeAdmin = false;     // dirigeant : transaction conclue hors du site, équipes libres, exécutée tout de suite
  let colonneActive = '';
  let destinationOuverte = '';   // carte qui montre le choix de l'équipe qui reçoit (3 équipes)
  let envoi = false;

  /* ---------- Utilitaires ---------- */
  function el(tag, cls, text){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    return e;
  }
  function logo(c, cls){
    const img = el('img', cls || 'tx-logo');
    img.src = 'https://lnhq.ca/Logos/' + c + '.png';
    img.alt = '';
    img.onerror = () => { img.style.visibility = 'hidden'; };
    return img;
  }
  const millions = n => (n / 1e6).toLocaleString('fr-CA', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' M$';
  const ecart = n => (n > 0 ? '+' : n < 0 ? '−' : '') + millions(Math.abs(n));
  const prenomNom = b => { const v = b.indexOf(','); return v > 0 ? b.slice(v + 1).trim() + ' ' + b.slice(0, v).trim() : b; };
  const quand = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const dateCourte = iso => { const d = new Date(iso); return isNaN(d) ? '' : quand.format(d); };
  function resteAvant(iso){
    const ms = new Date(iso).getTime() - Date.now();
    if(!(ms > 0)) return 'expirée';
    const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000);
    return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
  }

  function afficher(texte, erreur){
    const m = $('message');
    m.className = 'tx-message ' + (erreur ? 'is-erreur' : 'is-ok');
    m.textContent = texte;
    m.hidden = !texte;
    if(texte) m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  async function api(chemin, corps){
    try{
      const rep = await fetch(chemin, corps ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) } : undefined);
      return await rep.json();
    }catch(e){ return { ok: false, erreur: 'session' }; }
  }
  function texteRegle(e){
    const n = nom(e.equipe);
    return {
      plafond: `${n} dépasserait le plafond salarial de ${millions(e.montant || 0)}.`,
      plancher: `${n} tomberait sous le plancher salarial de ${millions(e.montant || 0)}.`,
      effectif: `${n} aurait ${e.nombre} joueurs sous contrat (maximum ${MAX_JOUEURS}).`,
      possession: `${prenomNom(e.joueur || '')} n’appartient plus à ${n}.`,
      vide: `${n} ne reçoit ni ne cède rien : retire cette équipe ou ajoute-lui un élément.`,
    }[e.regle] || 'Règle non respectée.';
  }
  function texteErreur(r){
    if(r.erreur === 'regles' && r.erreurs && r.erreurs.length) return 'Transaction impossible : ' + r.erreurs.map(texteRegle).join(' ');
    if(r.erreur === 'statut') return `Cette transaction est maintenant « ${r.statut} ».`;
    return ERREURS[r.erreur] || "L'opération a échoué. Réessaie dans un instant.";
  }

  /* ---------- Données publiques (classeur) ---------- */
  async function gviz(params){
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&${params}&t=${Date.now()}`, { cache: 'no-store' });
    if(!res.ok) throw new Error('http_' + res.status);
    const m = (await res.text()).match(/setResponse\(([\s\S]*)\);\s*$/);
    if(!m) throw new Error('format_inattendu');
    const json = JSON.parse(m[1]);
    if(json.status === 'error') throw new Error('erreur_gviz');
    return json.table;
  }
  const lignes = table => table.rows.map(r => (r.c || []).map(c => c ? String(c.f != null ? c.f : (c.v != null ? c.v : '')).trim() : ''));
  const argent = v => Number(String(v || '').replace(/[^\d.-]/g, '')) || 0;

  async function chargerMasses(){
    const t = await gviz('gid=' + GID_MASSE + '&headers=1');
    const ent = t.cols.map(c => (c.label || '').trim().toUpperCase());
    const i = { code: ent.indexOf('TM'), masse: ent.indexOf('MASSE'), plafond: ent.indexOf('PLAFOND'), plancher: ent.indexOf('PLANCHER'), tot: ent.indexOf('TOT') };
    masses = {};
    t.rows.forEach(r => {
      const c = r.c || [], v = k => c[i[k]] && c[i[k]].v != null ? Number(c[i[k]].v) || 0 : 0;
      const code = String((c[i.code] || {}).v || '').trim().toUpperCase();
      if(code) masses[code] = { masse: v('masse'), plafond: v('masse') + v('plafond'), plancher: v('masse') - v('plancher'), joueurs: v('tot') };
    });
  }
  async function chargerIds(){
    try{
      const t = await gviz('sheet=IDS_LNH&headers=1');
      if((t.cols[0] || {}).label !== 'Joueur') return;
      ids = new Map(lignes(t).filter(l => l[0] && /^\d{6,8}$/.test(l[1])).map(l => [l[0], l[1]]));
    }catch(e){ /* sans photos */ }
  }
  // Effectifs des équipes demandées (une seule requête pour celles qui manquent).
  async function chargerEffectifs(codes){
    const manquent = codes.filter(c => !effectifs.has(c));
    if(!manquent.length) return;
    const q = encodeURIComponent('select A, B, C, H, J, K, L, AB, G, N, Z, D where ' + manquent.map(c => `Z = '${c}'`).join(' or '));
    const t = await gviz('sheet=PLAYERSDATABASE&headers=1&tq=' + q);
    manquent.forEach(c => effectifs.set(c, []));
    lignes(t).forEach(l => {
      const code = (l[10] || '').toUpperCase();
      if(!l[1] || !effectifs.has(code)) return;
      const choix = (l[3] || '').toUpperCase() === 'CHOIX';
      const v = l[1].indexOf(',');
      const pos = choix ? [] : A.positions(l[3]);
      const espoir = /^(true|vrai|x|oui)$/i.test(l[7] || '');
      effectifs.get(code).push({
        id: l[1], joueur: l[1], equipe: code, type: choix ? 'choix' : espoir ? 'espoir' : 'joueur',
        prenom: v > 0 ? l[1].slice(v + 1).trim() : '', famille: v > 0 ? l[1].slice(0, v).trim() : l[1],
        nom: l[0] || prenomNom(l[1]), ov: Number(l[2]) || 0, po: pos[0] || '', positions: pos,
        poTexte: pos.map(p => ({ C: 'C', LW: 'AG', RW: 'AD', LD: 'DG', RD: 'DD', D: 'D', G: 'G' })[p] || p).join('/'),
        sh: (l[4] || '').toUpperCase(), ht: l[5] || '', wt: l[6] || '', espoir, pays: (l[8] || '').toUpperCase(),
        salaire: argent(l[9]), age: l[11] ? Math.floor(Number(l[11])) : '', idLnh: ids.get(l[1]) || '',
      });
    });
  }
  const element = (joueur, de) => (effectifs.get(de) || []).find(e => e.joueur === joueur);

  /* ---------- Bilan (même calcul que le script) ---------- */
  function bilan(equipes, mouvements){
    const b = {}, erreurs = [];
    equipes.forEach(c => {
      const m = masses[c] || {};
      b[c] = { masseAvant: m.masse || 0, masseApres: m.masse || 0, plafond: m.plafond, plancher: m.plancher,
        joueursAvant: m.joueurs || 0, joueursApres: m.joueurs || 0, recoit: [], cede: [] };
    });
    mouvements.forEach(mv => {
      const e = element(mv.joueur, mv.de);
      if(!e){ erreurs.push({ regle: 'possession', equipe: mv.de, joueur: mv.joueur }); return; }
      b[mv.de].cede.push(e);
      b[mv.vers].recoit.push(Object.assign({ de: mv.de }, e));
      if(e.type !== 'joueur') return;
      b[mv.de].masseApres -= e.salaire; b[mv.vers].masseApres += e.salaire;
      b[mv.de].joueursApres--; b[mv.vers].joueursApres++;
    });
    equipes.forEach(c => {
      const x = b[c];
      if(!x.recoit.length && !x.cede.length) erreurs.push({ regle: 'vide', equipe: c });
      if(x.plafond && x.masseApres > x.plafond && x.masseApres > x.masseAvant) erreurs.push({ regle: 'plafond', equipe: c, montant: x.masseApres - x.plafond });
      if(x.plancher && x.masseApres < x.plancher && x.masseApres < x.masseAvant) erreurs.push({ regle: 'plancher', equipe: c, montant: x.plancher - x.masseApres });
      if(x.joueursApres > MAX_JOUEURS && x.joueursApres > x.joueursAvant) erreurs.push({ regle: 'effectif', equipe: c, nombre: x.joueursApres });
    });
    return { bilan: b, erreurs };
  }
  const mouvementsOffre = () => [...offre.choix].map(([cle, vers]) => { const i = cle.lastIndexOf('|'); return { joueur: cle.slice(0, i), de: cle.slice(i + 1), vers }; });

  /* ---------- Cartes ---------- */
  // Choix de repêchage « 1re ronde 2027 (TOR) » : ronde en gros, logo de l'équipe d'origine.
  function carteChoix(e){
    const m = /^(\S+)\s+ronde\s+(\d{4})\s*\((\w+)\)/i.exec(e.joueur) || [];
    const c = el('div', 'al-carte tx-carte-choix a-photo');
    const haut = el('div', 'al-haut');
    haut.append(el('span', 'al-ov', m[1] || '?'), el('span', 'al-place', 'Choix'));
    const lg = logo(m[3] || e.equipe, 'al-photo tx-choix-logo');
    const nomC = el('div', 'al-nom');
    nomC.append(el('span', 'al-prenom', 'Ronde · repêchage'), el('span', 'al-famille', m[2] || ''));
    const infos = el('div', 'al-infos');
    infos.append(el('span', null, m[3] ? (m[3] === e.equipe ? 'Son propre choix' : 'Choix de ' + m[3]) : e.joueur));
    c.append(haut, lg, nomC, infos);
    c.title = e.joueur;
    return c;
  }
  function carte(e){
    const c = e.type === 'choix' ? carteChoix(e) : A.carte(e, e.poTexte);
    if(e.type !== 'choix'){
      // Salaire en tête des infos du bas (espoir : hors masse).
      const infos = c.querySelector('.al-infos') || c;
      infos.prepend(el('span', 'tx-salaire' + (e.type === 'espoir' ? ' is-espoir' : ''), e.type === 'espoir' ? 'Hors masse' : e.salaire ? millions(e.salaire) : '—'));
      c.title = `${e.nom} · ${e.poTexte}${e.ov ? ' · ' + e.ov + ' OV' : ''}${e.salaire ? ' · ' + millions(e.salaire) : ''}${e.espoir ? ' · espoir (hors masse)' : ''}`;
    }
    return c;
  }

  // Nom de famille trop large : police réduite (comme la page Équipe).
  function ajusterNoms(racine){
    racine.querySelectorAll('.al-famille').forEach(f => {
      f.style.fontSize = '';
      let taille = parseFloat(getComputedStyle(f).fontSize);
      while(f.scrollWidth > f.clientWidth + 1 && taille > 9){ taille -= 0.5; f.style.fontSize = taille + 'px'; }
    });
  }

  /* ---------- Composer une offre ---------- */
  const SECTIONS = [
    ['Attaquants', e => e.type === 'joueur' && A.groupePo(e.po) === 'A'],
    ['Défenseurs', e => e.type === 'joueur' && A.groupePo(e.po) === 'D'],
    ['Gardiens', e => e.type === 'joueur' && e.po === 'G'],
    ['Espoirs', e => e.type === 'espoir'],
    ['Choix de repêchage', e => e.type === 'choix'],
  ];

  function toucher(e){
    if(envoi) return;
    const cle = e.joueur + '|' + e.equipe;
    if(offre.choix.has(cle)){ offre.choix.delete(cle); destinationOuverte = ''; }
    else{
      const autres = offre.equipes.filter(c => c !== e.equipe);
      if(autres.length === 1){ offre.choix.set(cle, autres[0]); destinationOuverte = ''; }
      else destinationOuverte = destinationOuverte === cle ? '' : cle;   // 3 équipes : à qui ?
    }
    rendreAtelier();
  }

  function carteCliquable(e){
    const cle = e.joueur + '|' + e.equipe;
    const c = carte(e);
    const vers = offre.choix.get(cle);
    c.classList.add('tx-carte');
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    c.setAttribute('aria-pressed', vers ? 'true' : 'false');
    if(vers){
      c.classList.add('is-choisie');
      const ruban = el('span', 'tx-vers');
      ruban.append(el('span', null, '→'), logo(vers, 'tx-vers-logo'), el('span', null, nom(vers)));
      c.append(ruban);
    }
    if(destinationOuverte === cle){
      const menu = el('div', 'tx-dest');
      menu.append(el('span', 'tx-dest-titre', 'Envoyer à'));
      offre.equipes.filter(x => x !== e.equipe).forEach(x => {
        const b = el('button', 'tx-dest-btn');
        b.type = 'button';
        b.append(logo(x, 'tx-dest-logo'), el('span', null, nom(x)));
        b.addEventListener('click', ev => { ev.stopPropagation(); offre.choix.set(cle, x); destinationOuverte = ''; rendreAtelier(); });
        menu.append(b);
      });
      c.append(menu);
    }
    c.addEventListener('click', () => toucher(e));
    c.addEventListener('keydown', ev => { if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); toucher(e); } });
    return c;
  }

  function colonne(c, b){
    const col = el('section', 'tx-colonne' + (c === colonneActive ? ' is-active' : ''));
    couleursEquipe(col, c);
    const tete = el('header', 'tx-tete');
    const titre = el('div', 'tx-tete-nom');
    titre.append(logo(c, 'tx-tete-logo'), el('h2', null, nom(c) + (c === moi.code && !modeAdmin ? ' · toi' : '')));
    const m = masses[c] || {};
    const stats = el('div', 'tx-tete-stats');
    const stat = (libelle, valeur) => { const s = el('span'); s.append(el('small', null, libelle), el('b', null, valeur)); return s; };
    stats.append(stat('Masse', millions(m.masse || 0)), stat('Espace', millions((m.plafond || 0) - (m.masse || 0))), stat('Joueurs', `${m.joueurs || 0}/${MAX_JOUEURS}`));
    tete.append(titre, stats);
    if(c !== moi.code || modeAdmin){
      const retirer = el('button', 'tx-retirer', '✕');
      retirer.type = 'button';
      retirer.title = 'Retirer ' + nom(c) + ' de l’offre';
      retirer.setAttribute('aria-label', retirer.title);
      retirer.addEventListener('click', () => retirerEquipe(c));
      tete.append(retirer);
    }
    col.append(tete);
    const items = (effectifs.get(c) || []).slice().sort((a, x) => (x.ov - a.ov) || a.joueur.localeCompare(x.joueur, 'fr'));
    if(!effectifs.has(c)){ col.append(el('p', 'tx-aide', 'Chargement de l’effectif…')); return col; }
    SECTIONS.forEach(([titreS, filtre]) => {
      const liste = items.filter(filtre);
      if(!liste.length) return;
      const choisis = liste.filter(e => offre.choix.has(e.joueur + '|' + e.equipe)).length;
      const s = el('div', 'tx-section');
      const h = el('h3', 'tx-section-titre', titreS);
      h.append(el('span', null, choisis ? `${choisis} sur ${liste.length}` : String(liste.length)));
      const grille = el('div', 'al-cartes tx-cartes');
      liste.forEach(e => grille.append(carteCliquable(e)));
      s.append(h, grille);
      col.append(s);
    });
    return col;
  }

  function rendreBilan(){
    const mouvements = mouvementsOffre();
    const r = bilan(offre.equipes, mouvements);
    const zone = $('bilan');
    const blocs = offre.equipes.map(c => {
      const x = r.bilan[c];
      const b = el('section', 'tx-bilan-equipe');
      couleursEquipe(b, c);
      const h = el('h3');
      h.append(logo(c, 'tx-logo'), el('span', null, nom(c)));
      b.append(h);
      const groupe = (titre, items, recoit) => {
        const g = el('div', 'tx-bilan-groupe');
        g.append(el('small', null, titre));
        if(!items.length){ g.append(el('span', 'tx-vide', 'Rien')); return g; }
        const ul = el('ul', 'tx-puces');
        items.forEach(e => {
          const li = el('li', 'tx-puce' + (e.type === 'choix' ? ' is-choix' : ''));
          li.append(el('b', null, e.type === 'choix' ? 'CHOIX' : String(e.ov || '–')),
            el('span', null, e.type === 'choix' ? e.joueur : prenomNom(e.joueur)));
          const detail = e.type === 'joueur' ? millions(e.salaire) : e.type === 'espoir' ? 'espoir' : '';
          if(detail) li.append(el('em', null, detail));
          if(recoit && offre.equipes.length > 2) li.append(logo(e.de, 'tx-puce-de'));
          if(!recoit){
            const x = el('button', 'tx-puce-retirer', '×');
            x.type = 'button';
            x.title = 'Retirer de l’offre';
            x.setAttribute('aria-label', 'Retirer ' + (e.type === 'choix' ? e.joueur : prenomNom(e.joueur)) + ' de l’offre');
            x.addEventListener('click', () => { offre.choix.delete(e.joueur + '|' + e.equipe); rendreAtelier(); });
            li.append(x);
          }
          ul.append(li);
        });
        g.append(ul);
        return g;
      };
      b.append(groupe('Reçoit', x.recoit, true), groupe('Cède', x.cede, false));
      const chiffres = el('dl', 'tx-chiffres');
      const ligne = (dt, avant, apres, mauvais, fmt) => {
        chiffres.append(el('dt', null, dt));
        const dd = el('dd', mauvais ? 'is-mauvais' : '');
        dd.append(el('span', null, fmt(avant)));
        if(apres !== avant){ dd.append(el('span', 'tx-fleche', '→'), el('b', null, fmt(apres))); }
        chiffres.append(dd);
      };
      const regle = k => r.erreurs.some(e => e.equipe === c && e.regle === k);
      ligne('Masse', x.masseAvant, x.masseApres, regle('plafond') || regle('plancher'), millions);
      ligne('Espace', (x.plafond || 0) - x.masseAvant, (x.plafond || 0) - x.masseApres, regle('plafond'), millions);
      ligne('Joueurs', x.joueursAvant, x.joueursApres, regle('effectif'), n => `${n}/${MAX_JOUEURS}`);
      b.append(chiffres);
      return b;
    });
    const titre = el('h2', 'tx-bilan-titre', 'Bilan de l’offre');
    const fin = el('div', 'tx-bilan-fin');
    const problemes = r.erreurs.filter(e => e.regle !== 'vide' || mouvements.length);
    if(mouvements.length && problemes.length){
      const ul = el('ul', 'tx-erreurs');
      problemes.forEach(e => ul.append(el('li', null, texteRegle(e))));
      fin.append(ul);
    }
    const bouton = el('button', 'tx-bouton tx-principal',
      envoi ? 'Envoi…' : modeAdmin ? 'Enregistrer la transaction' : offre.remplace ? 'Envoyer la contre-offre' : 'Envoyer l’offre');
    bouton.type = 'button';
    bouton.disabled = envoi || !mouvements.length || r.erreurs.length > 0;
    bouton.addEventListener('click', modeAdmin ? enregistrer : envoyer);
    if(modeAdmin){
      fin.append(bouton, el('p', 'tx-note', 'Mode admin : pas d’acceptation des DG. Les joueurs et choix changent d’équipe dès l’enregistrement, et la transaction est annoncée sur le site et dans Discord.'));
    }else{
      const msg = el('textarea', 'tx-mot');
      msg.placeholder = 'Un mot pour l’autre DG (facultatif, privé)';
      msg.maxLength = 600;
      msg.rows = 3;
      msg.value = offre.message;
      msg.addEventListener('input', () => { offre.message = msg.value; });
      fin.append(msg, bouton, el('p', 'tx-note', `L’offre est privée et expire après 48 h sans réponse. Quand toutes les équipes l’ont acceptée, un dirigeant l’approuve, puis les joueurs changent d’équipe.`));
    }
    zone.replaceChildren(titre, ...blocs, fin);

    const n = mouvements.length;
    const panier = $('panier');
    panier.hidden = !n;
    panier.textContent = '';
    panier.append(el('b', null, `${n} élément${n > 1 ? 's' : ''}`), el('span', null, r.erreurs.length ? '⚠ à corriger' : 'Voir le bilan ↓'));
    panier.classList.toggle('is-erreur', r.erreurs.length > 0);
  }

  function rendreAtelier(){
    const atelier = $('atelier');
    atelier.hidden = offre.equipes.length < 2;
    // Onglets d'équipe (téléphone : une colonne à la fois).
    if(!offre.equipes.includes(colonneActive)) colonneActive = offre.equipes[1] || offre.equipes[0];
    const onglets = $('choixColonne');
    onglets.replaceChildren(...offre.equipes.map(c => {
      const b = el('button', 'tx-onglet-equipe' + (c === colonneActive ? ' is-active' : ''));
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', c === colonneActive ? 'true' : 'false');
      couleursEquipe(b, c);
      const n = mouvementsOffre().filter(m => m.de === c).length;
      b.append(logo(c, 'tx-logo'), el('span', null, nom(c)));
      if(n) b.append(el('span', 'tx-pastille', String(n)));
      b.addEventListener('click', () => { colonneActive = c; destinationOuverte = ''; rendreAtelier(); });
      return b;
    }));
    const cols = $('colonnes');
    cols.style.setProperty('--n', offre.equipes.length);
    cols.replaceChildren(...offre.equipes.map(c => colonne(c)));
    requestAnimationFrame(() => ajusterNoms(cols));
    rendrePartenaires();
    rendreBilan();
  }

  function rendrePartenaires(){
    const zone = $('partenaires');
    const puces = offre.equipes.map((c, i) => {
      const p = el('span', 'tx-partenaire' + (i === 0 && !modeAdmin ? ' is-moi' : ''));
      couleursEquipe(p, c);
      p.append(logo(c, 'tx-logo'), el('b', null, nom(c)));
      return p;
    });
    const morceaux = [];
    puces.forEach((p, i) => { if(i) morceaux.push(el('span', 'tx-echange', '⇄')); morceaux.push(p); });
    if(offre.equipes.length < 3){
      const ajouter = el('button', 'tx-ajouter', offre.equipes.length < 2 ? '+ Choisir une équipe' : '+ 3e équipe');
      if(modeAdmin && !offre.equipes.length) ajouter.textContent = '+ 1re équipe';
      ajouter.type = 'button';
      ajouter.addEventListener('click', ouvrirModal);
      if(offre.equipes.length > 1) morceaux.push(el('span', 'tx-echange', '⇄'));
      morceaux.push(ajouter);
    }
    zone.replaceChildren(...morceaux);
    $('aideNouvelle').textContent = offre.equipes.length < 2
      ? (modeAdmin ? 'Choisis les équipes de la transaction (2 ou 3).' : 'Choisis l’équipe avec qui tu veux transiger (tu pourras ajouter une 3e équipe).')
      : offre.equipes.length === 2
        ? 'Touche les joueurs, espoirs et choix à échanger, des deux côtés. Touche de nouveau une carte pour la retirer.'
        : 'Touche une carte, puis choisis l’équipe qui la reçoit. Touche de nouveau une carte choisie pour la retirer.';
  }

  async function ajouterEquipe(c){
    if(offre.equipes.includes(c) || offre.equipes.length >= 3) return;
    offre.equipes.push(c);
    colonneActive = c;
    rendreAtelier();
    try{ await chargerEffectifs([c]); }
    catch(e){ afficher('Impossible de lire l’effectif de ' + nom(c) + ' pour le moment.', true); }
    rendreAtelier();
  }
  function retirerEquipe(c){
    const touches = mouvementsOffre().filter(m => m.de === c || m.vers === c).length;
    if(touches && !confirm(`Retirer ${nom(c)} de l’offre ? Les ${touches} élément(s) qui la concernent seront retirés.`)) return;
    offre.equipes = offre.equipes.filter(x => x !== c);
    [...offre.choix].forEach(([cle, vers]) => { if(vers === c || cle.endsWith('|' + c)) offre.choix.delete(cle); });
    // Il reste 2 équipes : tout ce qui part va à l'autre.
    if(offre.equipes.length === 2) [...offre.choix].forEach(([cle]) => offre.choix.set(cle, offre.equipes.find(x => !cle.endsWith('|' + x))));
    destinationOuverte = '';
    rendreAtelier();
    $('atelier').hidden = offre.equipes.length < 2;
  }

  function ouvrirModal(){
    const grille = $('grilleEquipes');
    grille.replaceChildren(...Object.keys(EQUIPES).filter(c => !offre.equipes.includes(c))
      .sort((a, b) => nom(a).localeCompare(nom(b), 'fr')).map(c => {
        const b = el('button', 'tx-modal-equipe');
        b.type = 'button';
        b.append(logo(c, 'tx-modal-logo'), el('span', null, nom(c)));
        b.addEventListener('click', () => { $('modalEquipes').close(); ajouterEquipe(c); });
        return b;
      }));
    $('modalEquipes').showModal();
  }

  function nouvelleOffre(){
    offre.equipes = modeAdmin ? [] : [moi.code];
    offre.choix = new Map();
    offre.message = '';
    offre.remplace = null;
    $('bandeauContre').hidden = true;
    destinationOuverte = '';
    rendreAtelier();
  }

  async function envoyer(){
    const mouvements = mouvementsOffre();
    if(envoi || !mouvements.length) return;
    envoi = true; rendreBilan();
    const r = await api('/api/transactions/proposer', {
      equipes: offre.equipes, mouvements: mouvements.map(m => ({ joueur: m.joueur, de: m.de, vers: m.vers })),
      message: offre.message, remplace: offre.remplace ? offre.remplace.id : '',
    });
    envoi = false;
    if(!r.ok){ rendreBilan(); afficher(texteErreur(r), true); return; }
    const autres = offre.equipes.filter(c => c !== moi.code).map(nom).join(' et ');
    nouvelleOffre();
    await chargerListe();
    allerA('envoyees');
    afficher(`Offre envoyée à ${autres}. Elle attend leur réponse (48 h).`, false);
  }

  // Mode admin : transaction conclue hors du site, exécutée et annoncée dès l'enregistrement.
  async function enregistrer(){
    const mouvements = mouvementsOffre();
    if(envoi || !mouvements.length) return;
    const noms = offre.equipes.map(nom).join(', ');
    if(!confirm(`Enregistrer la transaction entre ${noms} ? Les joueurs et choix changent d’équipe tout de suite, et la transaction est annoncée sur le site et dans Discord.`)) return;
    envoi = true; rendreBilan();
    const r = await api('/api/transactions/enregistrer', {
      equipes: offre.equipes, mouvements: mouvements.map(m => ({ joueur: m.joueur, de: m.de, vers: m.vers })),
    });
    envoi = false;
    if(!r.ok){ rendreBilan(); afficher(texteErreur(r), true); return; }
    offre.equipes.forEach(c => effectifs.delete(c));
    offre.choix = new Map();
    await Promise.all([chargerListe(), chargerMasses().catch(() => {})]);
    nouvelleOffre();
    allerA('historique');
    afficher('Transaction enregistrée : les joueurs ont changé d’équipe' + (r.discord === false ? ' (l’annonce Discord n’est pas partie).' : ' et l’annonce est publiée.'), false);
  }

  function changerMode(actif){
    if(actif === modeAdmin) return;
    if(offre.choix.size && !confirm('Changer de mode efface l’offre en cours. Continuer ?')){ $('modeAdmin').checked = modeAdmin; return; }
    modeAdmin = actif;
    $('modeAdmin').checked = actif;
    nouvelleOffre();
  }

  // Contre-offre : l'offre reçue s'ouvre dans l'atelier, modifiable ; l'ancienne sera remplacée.
  async function contreOffre(t){
    if(modeAdmin){ modeAdmin = false; $('modeAdmin').checked = false; }
    offre.equipes = [moi.code, ...t.equipes.filter(c => c !== moi.code)];
    offre.choix = new Map(t.mouvements.map(m => [m.joueur + '|' + m.de, m.vers]));
    offre.message = '';
    offre.remplace = t;
    $('texteContre').textContent = `Contre-offre à l’offre de ${nom(t.par)} : modifie-la puis envoie-la. L’offre d’origine sera remplacée.`;
    $('bandeauContre').hidden = false;
    allerA('nouvelle');
    rendreAtelier();
    try{ await chargerEffectifs(offre.equipes); }catch(e){ afficher('Impossible de lire les effectifs pour le moment.', true); rendreAtelier(); return; }
    // Élément qui a changé d'équipe depuis l'offre : retiré (sa carte n'existe plus).
    const partis = mouvementsOffre().filter(m => !element(m.joueur, m.de));
    partis.forEach(m => offre.choix.delete(m.joueur + '|' + m.de));
    if(partis.length) afficher('Retiré de la contre-offre (n’appartient plus à la même équipe) : ' + partis.map(m => prenomNom(m.joueur)).join(', ') + '.', true);
    rendreAtelier();
  }

  /* ---------- Listes d'offres ---------- */
  function ligneElement(m, plusieurs){
    const li = el('li', 'tx-element' + (m.type === 'choix' ? ' is-choix' : ''));
    li.append(el('b', 'tx-element-ov', m.type === 'choix' ? 'CHOIX' : String(m.ov || '–')));
    const texte = el('span', 'tx-element-nom');
    texte.append(el('strong', null, m.type === 'choix' ? m.joueur : prenomNom(m.joueur)));
    const details = m.type === 'choix' ? [] : [m.po, m.type === 'espoir' ? 'espoir' : m.salaire ? millions(m.salaire) : ''].filter(Boolean);
    if(details.length) texte.append(el('small', null, details.join(' · ')));
    li.append(texte);
    if(plusieurs){
      const de = el('span', 'tx-element-de');
      de.append(el('small', null, 'de'), logo(m.de, 'tx-element-logo'));
      de.title = 'de ' + nom(m.de);
      li.append(de);
    }
    return li;
  }

  function carteOffre(t){
    const etat = STATUTS[t.statut] || 'fermee';
    const a = el('article', 'tx-offre is-' + etat);
    a.id = 't-' + t.id;
    const tete = el('header', 'tx-offre-tete');
    const logos = el('div', 'tx-offre-logos');
    t.equipes.forEach((c, i) => { if(i) logos.append(el('span', 'tx-echange', '⇄')); logos.append(logo(c, 'tx-offre-logo')); });
    const titre = el('div', 'tx-offre-titre');
    titre.append(el('h3', null, t.equipes.map(nom).join(t.equipes.length === 2 ? ' ⇄ ' : ' · ')),
      el('small', null, (EQUIPES[t.par] ? `Proposée par ${nom(t.par)}` : 'Conclue hors du site, saisie par un dirigeant') + ` · ${dateCourte(t.cree)}`));
    tete.append(logos, titre, el('span', 'tx-statut is-' + etat, t.statut));
    a.append(tete);

    const corps = el('div', 'tx-offre-equipes');
    corps.style.setProperty('--n', t.equipes.length);
    t.equipes.forEach(c => {
      const bloc = el('section', 'tx-recoit');
      couleursEquipe(bloc, c);
      const h = el('h4');
      h.append(logo(c, 'tx-logo'), el('span', null, nom(c) + ' reçoit'));
      const ul = el('ul', 'tx-elements');
      const recus = t.mouvements.filter(m => m.vers === c);
      recus.forEach(m => ul.append(ligneElement(m, t.equipes.length > 2)));
      if(!recus.length) ul.append(el('li', 'tx-vide', 'Rien'));
      bloc.append(h, ul);
      if(t.bilan && t.bilan[c]){
        const x = t.bilan[c];
        const mauvais = (t.erreurs || []).some(e => e.equipe === c);
        const p = el('p', 'tx-recoit-masse' + (mauvais ? ' is-mauvais' : ''));
        p.textContent = `Masse ${millions(x.masseAvant)} → ${millions(x.masseApres)} (${ecart(x.masseApres - x.masseAvant)}) · ${x.joueursApres}/${MAX_JOUEURS} joueurs`;
        bloc.append(p);
      }
      corps.append(bloc);
    });
    a.append(corps);

    if(t.message){
      const q = el('blockquote', 'tx-offre-mot', t.message);
      a.append(q);
    }
    if(t.erreurs && t.erreurs.length){
      const ul = el('ul', 'tx-erreurs');
      t.erreurs.forEach(e => ul.append(el('li', null, texteRegle(e))));
      a.append(ul);
    }

    const pied = el('footer', 'tx-offre-pied');
    const suivi = el('div', 'tx-suivi');
    if(t.statut === 'En attente' || t.statut === 'À approuver'){
      t.equipes.forEach(c => {
        const ok = t.acceptees.includes(c);
        const s = el('span', 'tx-accord' + (ok ? ' is-ok' : ''));
        s.append(logo(c, 'tx-logo'), el('span', null, ok ? '✓' : '…'));
        s.title = nom(c) + (ok ? ' a accepté' : ' n’a pas encore répondu');
        suivi.append(s);
      });
      if(t.statut === 'En attente') suivi.append(el('small', 'tx-expire', 'Expire dans ' + resteAvant(t.expire)));
      else suivi.append(el('small', 'tx-expire', 'Acceptée par toutes les équipes · en attente d’un dirigeant'));
    }else{
      const fin = [t.decideeLe ? dateCourte(t.decideeLe) : '', t.decideePar && t.statut !== 'Expirée' ? 'par ' + (EQUIPES[t.decideePar] ? nom(t.decideePar) : t.decideePar) : '', t.note].filter(Boolean).join(' · ');
      if(fin) suivi.append(el('small', 'tx-expire', fin));
      if(t.publication){
        const lien = el('a', 'tx-lien', 'Voir l’annonce →');
        lien.href = t.publication; lien.target = '_blank'; lien.rel = 'noopener';
        suivi.append(lien);
      }
    }
    const actions = el('div', 'tx-actions');
    const bouton = (texte, cls, fn) => { const b = el('button', 'tx-bouton ' + (cls || ''), texte); b.type = 'button'; b.addEventListener('click', () => fn(b)); actions.append(b); return b; };
    const concernee = moi.code && t.equipes.includes(moi.code);
    if(t.statut === 'En attente' && concernee && !t.acceptees.includes(moi.code)){
      const bloque = (t.erreurs || []).length > 0;
      const acc = bouton('Accepter', 'tx-principal', b => repondre(t, 'accepter', b));
      if(bloque){ acc.disabled = true; acc.title = 'La transaction ne respecte plus les règles'; }
      bouton('Contre-offre', '', () => contreOffre(t));
      bouton('Refuser', 'tx-danger', b => repondre(t, 'refuser', b));
    }
    if(OUVERTS.includes(t.statut) && t.par === moi.code) bouton('Retirer l’offre', 'tx-danger', b => annuler(t, b));
    if(t.statut === 'À approuver' && moi.admin){
      const ok = bouton('Approuver la transaction', 'tx-principal', b => decider(t, 'approuver', b));
      if((t.erreurs || []).length){ ok.disabled = true; ok.title = 'La transaction ne respecte plus les règles'; }
      bouton('Rejeter', 'tx-danger', b => decider(t, 'rejeter', b));
    }
    pied.append(suivi);
    if(actions.children.length) pied.append(actions);
    a.append(pied);
    return a;
  }

  async function action(chemin, corps, bouton, succes){
    if(envoi) return;
    envoi = true;
    const texte = bouton.textContent;
    bouton.disabled = true; bouton.textContent = '…';
    const r = await api(chemin, corps);
    envoi = false;
    bouton.textContent = texte; bouton.disabled = false;
    if(!r.ok){ afficher(texteErreur(r), true); await chargerListe(); rendreListe(); return; }
    await chargerListe();
    rendreListe();
    afficher(typeof succes === 'function' ? succes(r) : succes, false);
  }
  function repondre(t, reponse, bouton){
    const autres = t.equipes.filter(c => c !== moi.code).map(nom).join(' et ');
    if(reponse === 'accepter' && !confirm(`Accepter la transaction avec ${autres} ? Elle sera ensuite soumise à un dirigeant.`)) return;
    if(reponse === 'refuser' && !confirm(`Refuser l’offre de ${nom(t.par)} ?`)) return;
    action('/api/transactions/repondre', { id: t.id, reponse }, bouton, r =>
      reponse === 'refuser' ? 'Offre refusée.'
        : r.statut === 'À approuver' ? 'Offre acceptée : toutes les équipes sont d’accord, elle attend maintenant un dirigeant.'
        : 'Offre acceptée : on attend encore la réponse de l’autre équipe.');
  }
  function annuler(t, bouton){
    if(!confirm('Retirer cette offre ?')) return;
    action('/api/transactions/annuler', { id: t.id }, bouton, 'Offre retirée.');
  }
  function decider(t, decision, bouton){
    let note = '';
    if(decision === 'approuver'){
      if(!confirm('Approuver ? Les joueurs et choix changent d’équipe tout de suite, et la transaction est annoncée sur le site et dans Discord.')) return;
    }else{
      note = prompt('Rejeter la transaction. Raison (visible par les équipes, facultative) :', '');
      if(note === null) return;
    }
    action('/api/transactions/decider', { id: t.id, decision, note }, bouton, r => {
      if(decision !== 'approuver') return 'Transaction rejetée.';
      t.equipes.forEach(c => effectifs.delete(c));
      chargerMasses().catch(() => {});
      return 'Transaction approuvée : les joueurs ont changé d’équipe' + (r.discord === false ? ' (l’annonce Discord n’est pas partie).' : ' et l’annonce est publiée.');
    });
  }

  const FILTRES = {
    recues: t => OUVERTS.includes(t.statut) && t.equipes.includes(moi.code) && t.par !== moi.code,
    envoyees: t => OUVERTS.includes(t.statut) && t.par === moi.code,
    approbation: t => t.statut === 'À approuver',
    // Historique : seulement les transactions de son équipe (dirigeant sans équipe : toutes).
    historique: t => !OUVERTS.includes(t.statut) && (!moi.code || t.equipes.includes(moi.code)),
  };
  const VIDES = {
    recues: 'Aucune offre reçue pour l’instant.',
    envoyees: 'Aucune offre envoyée en attente.',
    approbation: 'Aucune transaction à approuver.',
    historique: 'Aucune transaction terminée.',
  };
  function rendreListe(){
    majPastilles();
    if(vue === 'nouvelle') return;
    const items = liste.filter(FILTRES[vue]);
    $('liste').replaceChildren(...(items.length ? items.map(carteOffre) : [el('p', 'tx-aide tx-liste-vide', VIDES[vue])]));
  }
  function majPastilles(){
    const pastille = (id, n) => { $(id).textContent = n; $(id).hidden = !n; };
    pastille('nbRecues', liste.filter(t => t.statut === 'En attente' && t.equipes.includes(moi.code) && !t.acceptees.includes(moi.code)).length);
    pastille('nbEnvoyees', liste.filter(FILTRES.envoyees).length);
    pastille('nbApprobation', moi.admin ? liste.filter(FILTRES.approbation).length : 0);
  }
  async function chargerListe(){
    const r = await api('/api/transactions');
    if(r.ok) liste = r.transactions || [];
    else afficher(texteErreur(r), true);
  }

  function allerA(v){
    vue = v;
    document.querySelectorAll('.tx-onglets button').forEach(b => b.classList.toggle('is-active', b.dataset.vue === v));
    $('vueNouvelle').hidden = v !== 'nouvelle';
    $('vueListe').hidden = v === 'nouvelle';
    afficher('', false);
    history.replaceState(null, '', '?vue=' + v);
    majPastilles();
    if(v === 'nouvelle') rendreAtelier();
    else rendreListe();
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
    $('qui').textContent = 'Transactions' + (sienne ? ' · ' + r.equipe : '') + (moi.admin ? ' · dirigeant' : '');
    if(sienne){
      couleursPage(sienne);
      $('lienEquipe').href = 'https://lnhq.ca/equipe.html?team=' + EQUIPES[sienne][1];
    }else{
      // Dirigeant sans équipe : seulement le mode admin pour composer.
      $('lienEquipe').href = 'https://lnhq.ca/';
      document.querySelector('[data-vue="recues"]').hidden = true;
      document.querySelector('[data-vue="envoyees"]').hidden = true;
      modeAdmin = true;
    }
    $('ongletApprobation').hidden = !moi.admin;
    if(moi.admin){
      $('blocAdmin').hidden = false;
      $('modeAdmin').checked = modeAdmin;
      $('modeAdmin').disabled = !sienne;
      $('modeAdmin').addEventListener('change', () => changerMode($('modeAdmin').checked));
    }
    $('barre').hidden = false;
    document.querySelectorAll('.tx-onglets button').forEach(b => b.addEventListener('click', () => allerA(b.dataset.vue)));
    $('fermerModal').addEventListener('click', () => $('modalEquipes').close());
    $('modalEquipes').addEventListener('click', ev => { if(ev.target === $('modalEquipes')) $('modalEquipes').close(); });
    $('quitterContre').addEventListener('click', () => { nouvelleOffre(); });
    $('panier').addEventListener('click', () => $('bilan').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    // Bilan déjà à l'écran : la barre du bas (qui y mène) se retire.
    if('IntersectionObserver' in window){
      new IntersectionObserver(([e]) => document.body.classList.toggle('tx-bilan-visible', e.isIntersecting), { threshold: 0.05 }).observe($('bilan'));
    }
    // Clic hors d'une carte : ferme le choix de l'équipe qui reçoit.
    document.addEventListener('click', ev => { if(destinationOuverte && !ev.target.closest('.tx-carte')){ destinationOuverte = ''; rendreAtelier(); } });
    window.addEventListener('beforeunload', ev => { if(offre.choix.size && !envoi){ ev.preventDefault(); ev.returnValue = ''; } });

    if(sienne) offre.equipes = [sienne];
    await Promise.all([chargerListe(), chargerMasses().catch(() => afficher('Masse salariale illisible pour le moment : le bilan sera incomplet.', true)), chargerIds()]);
    if(sienne) await chargerEffectifs([sienne]).catch(() => {});

    const params = new URLSearchParams(location.search);
    const demandee = params.get('vue');
    const avec = (params.get('avec') || '').toUpperCase();
    const aRepondre = liste.some(t => t.statut === 'En attente' && t.equipes.includes(sienne) && !t.acceptees.includes(sienne));
    let depart = FILTRES[demandee] || demandee === 'nouvelle' ? demandee : (aRepondre ? 'recues' : 'nouvelle');
    if(!sienne && !['historique', 'nouvelle'].includes(depart)) depart = 'approbation';
    allerA(depart);
    if(sienne && EQUIPES[avec] && avec !== sienne){ allerA('nouvelle'); ajouterEquipe(avec); }
    // Les offres changent (réponses des autres DG) : rafraîchies chaque minute hors de l'atelier.
    setInterval(async () => { if(document.hidden || vue === 'nouvelle' || envoi) return; await chargerListe(); rendreListe(); }, 60000);
  }

  demarrer();
})();
