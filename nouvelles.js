/* =========================================================================
   LNHQ — fils d'annonces et de nouvelles, lus dans les onglets ANNONCES et
   NOUVELLES du classeur (remplis par publier.lnhq.ca). Réglé par les attributs
   de <main id="feed"> : data-tab (fil affiché au départ), data-form-url.
   Si la page a des onglets (.feed-tabs button[data-fil]), on passe d'un fil à
   l'autre sans recharger ; le fil choisi est dans l'adresse (?fil=nouvelles).
   ========================================================================= */
(function(){
  const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';
  const HEADERS = ['Date', 'Équipe', 'Type', 'Titre', 'Texte', 'Photos', 'Visible', 'Épinglé'];
  const TYPE_CLASS = {
    'Transaction': 'type-transaction',
    'Résultat': 'type-resultat',
    'Blessure': 'type-blessure',
    'Général': 'type-general',
    'Chronique': 'type-chronique',
    'Règlement': 'type-reglement',
    'Calendrier': 'type-calendrier',
    'Événement': 'type-evenement',
  };
  // Au-delà de cette hauteur (px), le texte est replié derrière « Lire la suite ».
  const HAUTEUR_REPLI = 420;
  const DRIVE_ID = /^[A-Za-z0-9_-]{20,}$/;

  const FILS = {
    ANNONCES: { nom: 'annonce', vide: "Aucune annonce pour l'instant." },
    NOUVELLES: { nom: 'nouvelle', vide: "Aucune nouvelle pour l'instant." },
    TRANSACTIONS: { nom: 'transaction', vide: "Aucune transaction pour l'instant." },
  };
  const feed = document.getElementById('feed');
  const onglets = [...document.querySelectorAll('.feed-tabs [data-fil]')];
  const demande = (new URLSearchParams(location.search).get('fil') || '').toUpperCase();
  let tab = FILS[demande] && onglets.length ? demande : feed.dataset.tab;
  let noun = FILS[tab] ? FILS[tab].nom : 'nouvelle';
  let CACHE_KEY = 'feedCache_' + tab;
  // Numéro du chargement en cours : la réponse d'un fil quitté entre-temps est ignorée.
  let chargement = 0;
  const teams = new Map((window.LNHQ_TEAMS || []).map(t => [t.name.toLowerCase(), t]));
  const dateFmt = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });

  const els = {
    title: document.getElementById('sheetTitle'),
    rowCount: document.getElementById('rowCount'),
    lastUpdated: document.getElementById('lastUpdated'),
    loader: document.getElementById('loader'),
    errorBox: document.getElementById('errorBox'),
    retryBtn: document.getElementById('retryBtn'),
    list: document.getElementById('newsList'),
    empty: document.getElementById('emptyState'),
    publish: document.getElementById('publishBtn'),
  };

  els.title.textContent = 'LNHQ';
  if(feed.dataset.formUrl){
    els.publish.href = feed.dataset.formUrl;
    els.publish.hidden = false;
  }
  if(window.marked) marked.use({ breaks: true, gfm: true });

  /* ---------- Lecture de l'onglet ---------- */
  function buildUrl(){
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=1`
      + `&sheet=${encodeURIComponent(tab)}&t=${Date.now()}`;
  }

  function parseGvizDate(v){
    const m = /^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?/.exec(v || '');
    return m ? new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null;
  }

  // Renvoie null si l'onglet n'existe pas encore : l'API renvoie alors en silence
  // le 1er onglet du classeur (DRAFT), qu'on reconnaît à ses en-têtes différents.
  function parseTable(table){
    const labels = table.cols.map(c => (c.label || '').trim());
    if(!HEADERS.every((h, i) => labels[i] === h)) return null;
    return table.rows.map(r => {
      const c = r.c || [];
      const val = i => (c[i] ? c[i].v : null);
      const str = i => (c[i] && c[i].v != null ? String(c[i].v).trim() : '');
      return {
        date: parseGvizDate(val(0)),
        equipe: str(1),
        type: str(2),
        titre: str(3),
        texte: str(4),
        photos: str(5).split(',').map(s => s.trim()).filter(id => DRIVE_ID.test(id)),
        visible: val(6) === true,
        epingle: val(7) === true,
        id: str(9).replace(/[^A-Za-z0-9_-]/g, ''),
        details: lireDetails(str(10)),
      };
    }).filter(n => n.visible && n.titre);
  }

  /* ---------- Rendu ---------- */
  function el(tag, cls, text){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    return e;
  }

  function photoUrl(id, width){
    return `https://lh3.googleusercontent.com/d/${id}=w${width}`;
  }

  function photoLink(id, cls, width){
    const a = el('a', cls);
    a.href = photoUrl(id, 2400);
    a.target = '_blank';
    a.rel = 'noopener';
    const img = el('img');
    img.src = photoUrl(id, width);
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => a.remove();
    a.append(img);
    return a;
  }

  function teamBadge(name){
    const team = teams.get(name.toLowerCase());
    const badge = el(team ? 'a' : 'span', 'news-team');
    if(team) badge.href = 'equipe.html?team=' + team.slug;
    const img = el('img');
    img.src = team ? `Logos/${team.code}.png` : 'logo-lnhq.png';
    img.alt = '';
    img.onerror = () => img.remove();
    badge.append(img, el('span', null, team ? team.name : (name || 'Ligue')));
    return badge;
  }

  // Couleurs de texte permises (même palette que l'éditeur de publier.lnhq.ca).
  const COULEURS = ['#e8590c', '#e03131', '#2f9e44', '#1c7ed6', '#e0a800', '#868e96'];

  // Le texte vient de membres de la ligue : le HTML produit par le Markdown est
  // nettoyé par DOMPurify avant d'être inséré. Sans les deux bibliothèques
  // (CDN inaccessible), on affiche le texte brut plutôt que du HTML non nettoyé.
  function renderText(text){
    const box = el('div', 'news-text');
    if(window.marked && window.DOMPurify){
      box.innerHTML = DOMPurify.sanitize(marked.parse(text));
      box.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
      // Seul style accepté : une couleur de la palette sur un <span>.
      box.querySelectorAll('[style]').forEach(n => {
        const couleur = /^\s*color:\s*(#[0-9a-f]{6})\s*;?\s*$/i.exec(n.getAttribute('style') || '');
        n.removeAttribute('style');
        if(n.tagName === 'SPAN' && couleur && COULEURS.includes(couleur[1].toLowerCase())) n.style.color = couleur[1];
      });
    }else{
      box.classList.add('is-plain');
      box.textContent = text;
    }
    return box;
  }

  function renderCard(n){
    const card = el('article', 'news-card ' + (TYPE_CLASS[n.type] || 'type-general') + (n.epingle ? ' is-pinned' : ''));
    if(n.id) card.id = 'n-' + n.id;
    if(n.photos.length) card.append(photoLink(n.photos[0], 'news-cover', 1400));

    const body = el('div', 'news-body');
    const meta = el('div', 'news-meta');
    meta.append(teamBadge(n.equipe), el('span', 'news-type', n.type || 'Général'));
    if(n.epingle) meta.append(el('span', 'news-pin', 'Épinglé'));
    if(n.date){
      const time = el('time', 'news-date', dateFmt.format(n.date));
      time.dateTime = n.date.toISOString();
      meta.append(time);
    }
    // Transaction (fil TRANSACTIONS) : les listes « X reçoit » du texte deviennent des cartes.
    const echange = n.details && n.details.length ? renderEchange(n.details) : null;
    const texte = renderText(echange ? sansListes(n.texte) : n.texte);
    const suite = el('button', 'news-more', 'Lire la suite');
    suite.type = 'button';
    suite.hidden = true;
    suite.addEventListener('click', () => {
      const replie = texte.classList.toggle('is-collapsed');
      texte.style.maxHeight = replie ? (texte.dataset.repli || '') : '';
      card.classList.toggle('is-deplie', !replie);
      suite.textContent = replie ? 'Lire la suite' : 'Réduire';
      if(replie) card.scrollIntoView({ block: 'nearest' });
    });
    body.append(meta, el('h2', 'news-title', n.titre), texte, suite);
    if(echange) body.append(echange);

    if(n.photos.length > 1){
      const gallery = el('div', 'news-gallery');
      n.photos.slice(1).forEach(id => gallery.append(photoLink(id, null, 400)));
      body.append(gallery);
    }
    card.append(body);
    return card;
  }

  // Replie les textes trop longs. Refait quand une image du texte finit de charger
  // (elle allonge le texte), sauf si le lecteur a déjà ouvert l'article.
  function replier(card){
    const texte = card.querySelector('.news-text');
    const suite = card.querySelector('.news-more');
    if(!texte || !suite || suite.dataset.ouvert) return;
    const cible = location.hash === '#' + card.id;
    const max = hauteurRepli(card, texte);
    const long = texte.scrollHeight > max + 60;
    texte.dataset.repli = long ? max + 'px' : '';
    texte.style.maxHeight = long && !cible ? texte.dataset.repli : '';
    texte.classList.toggle('is-collapsed', long && !cible);
    card.classList.toggle('is-deplie', long && cible);
    suite.hidden = !long;
    suite.textContent = long && !cible ? 'Lire la suite' : 'Réduire';
  }

  // Grand écran avec photo à gauche : le texte replié s'arrête pour que le bouton
  // « Lire la suite » tombe au bas de la photo (carte sans vide sous la photo).
  const BOUTON_SUITE = 46;     // .news-more : 40px + marge de 6px
  function hauteurRepli(card, texte){
    const couverture = card.querySelector(':scope > .news-cover');
    if(!couverture || !window.matchMedia('(min-width:900px)').matches) return HAUTEUR_REPLI;
    const haut = card.getBoundingClientRect().top;
    const basPhoto = couverture.getBoundingClientRect().bottom - haut;
    const debutTexte = texte.getBoundingClientRect().top - haut;
    return Math.max(120, Math.round(basPhoto - BOUTON_SUITE - debutTexte));
  }

  function preparerReplis(){
    els.list.querySelectorAll('.news-card').forEach(card => {
      replier(card);
      card.querySelector('.news-more').addEventListener('click', e => { e.currentTarget.dataset.ouvert = '1'; });
      // Une photo introuvable est retirée (photoLink) : on recalcule aussi dans ce cas.
      card.querySelectorAll('.news-text img, :scope > .news-cover img').forEach(img => {
        img.addEventListener('load', () => replier(card));
        img.addEventListener('error', () => replier(card));
      });
    });
  }
  // La hauteur de la photo change avec la largeur de la fenêtre.
  let attenteResize = 0;
  window.addEventListener('resize', () => {
    clearTimeout(attenteResize);
    attenteResize = setTimeout(() => els.list.querySelectorAll('.news-card').forEach(replier), 150);
  });

  function show(state){
    els.loader.hidden = state !== 'loading';
    els.errorBox.hidden = state !== 'error';
    if(state !== 'data'){ els.list.hidden = true; els.empty.hidden = true; }
  }

  function apply(table){
    const items = parseTable(table) || [];
    items.sort((a, b) => (b.epingle - a.epingle) || ((b.date || 0) - (a.date || 0)));
    els.list.replaceChildren(...items.map(renderCard));
    els.list.hidden = !items.length;
    els.empty.hidden = !!items.length;
    els.rowCount.textContent = items.length + ' ' + noun + (items.length > 1 ? 's' : '');
    show('data');
    preparerReplis();
    completerCartes();
  }

  /* ---------- Transactions : cartes des joueurs (comme l'alignement de la page Équipe) ----------
     Colonne K « Détails » du fil TRANSACTIONS : [{ joueur: 'Nom, Prénom', de, vers, type, po, ov, salaire }].
     Les cartes s'affichent d'abord avec ces détails, puis sont complétées (photo, drapeau,
     tir, taille) avec PLAYERSDATABASE et IDS_LNH. */
  const COULEURS_EQUIPES = {
    ANA: ['#F47A38', '#0D0D0D'], BOS: ['#FFB81C', '#000000'], BUF: ['#FCB514', '#002654'], CGY: ['#C8102E', '#4B0009'],
    CAR: ['#CC0000', '#000000'], CHI: ['#CF0A2C', '#000000'], COL: ['#6F263D', '#041E42'], CBJ: ['#CE1126', '#002654'],
    DAL: ['#006847', '#111111'], DET: ['#CE1126', '#000000'], EDM: ['#FF4C00', '#041E42'], FLA: ['#C8102E', '#041E42'],
    LAK: ['#8C9396', '#000000'], MIN: ['#A6192E', '#154734'], MTL: ['#AF1E2D', '#192168'], NSH: ['#FFB81C', '#041E42'],
    NJD: ['#CE1126', '#000000'], NYI: ['#F47D30', '#00539B'], NYR: ['#CE1126', '#001E60'], OTT: ['#C52032', '#000000'],
    PHI: ['#F74902', '#000000'], PIT: ['#FCB514', '#000000'], SJS: ['#006D75', '#000000'], SEA: ['#99D9D9', '#001628'],
    STL: ['#FCB514', '#002F87'], TBL: ['#0057B8', '#000000'], TOR: ['#003E7E', '#000000'], UTA: ['#69B3E7', '#000000'],
    VAN: ['#00843D', '#041C2C'], VGK: ['#B4975A', '#101820'], WSH: ['#C8102E', '#041E42'], WPG: ['#004C97', '#041E42'],
  };
  const equipeDeCode = new Map((window.LNHQ_TEAMS || []).map(t => [t.code, t]));
  const ETIQUETTES_PO = { C: 'C', LW: 'AG', RW: 'AD', LD: 'DG', RD: 'DD', D: 'D', G: 'G', L: 'AG', R: 'AD' };
  const infosJoueurs = new Map();   // « Nom, Prénom » → infos complètes (chargées une fois)
  let chargementIds = null;      // IDS_LNH (photos), lu une fois

  function lireDetails(v){
    if(!v) return null;
    try{ const d = JSON.parse(v); return Array.isArray(d) ? d.filter(m => m && m.joueur && m.vers) : null; }catch(e){ return null; }
  }
  // Retire du texte les listes « ## X reçoit » (remplacées par les cartes).
  const sansListes = t => String(t || '').replace(/^#{1,3}\s+.+\sreçoit\s*\n(?:[ \t]*\n)*(?:[ \t]*[-*]\s.*(?:\n|$))*/gim, '').trim();
  const millions = n => (n / 1e6).toLocaleString('fr-CA', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' M$';

  function joueurDeDetails(m){
    const info = infosJoueurs.get(m.joueur);
    if(info) return info;
    const v = m.joueur.indexOf(',');
    const pos = String(m.po || '').toUpperCase().split(/[\/,\s]+/).filter(Boolean);
    return { id: m.joueur, prenom: v > 0 ? m.joueur.slice(v + 1).trim() : '', famille: v > 0 ? m.joueur.slice(0, v).trim() : m.joueur,
      nom: m.joueur, ov: Number(m.ov) || 0, poTexte: pos.map(p => ETIQUETTES_PO[p] || p).join('/'), espoir: m.type === 'espoir',
      sh: '', ht: '', wt: '', pays: '', idLnh: '' };
  }

  function carteChoix(m){
    const r = /^(\S+)\s+ronde\s+(\d{4})\s*\((\w+)\)/i.exec(m.joueur) || [];
    const c = el('div', 'al-carte ech-choix a-photo');
    const haut = el('div', 'al-haut');
    haut.append(el('span', 'al-ov', r[1] || '?'), el('span', 'al-place', 'Choix'));
    const logo = el('img', 'al-photo ech-choix-logo');
    logo.src = 'Logos/' + (r[3] || m.de) + '.png';
    logo.alt = '';
    const nom = el('div', 'al-nom');
    nom.append(el('span', 'al-prenom', 'Ronde · repêchage'), el('span', 'al-famille', r[2] || ''));
    const infos = el('div', 'al-infos');
    infos.append(el('span', null, r[3] ? 'Choix de ' + r[3] : m.joueur));
    c.append(haut, logo, nom, infos);
    c.title = m.joueur;
    return c;
  }

  function carteEchange(m, plusieurs){
    let c;
    if(m.type === 'choix') c = carteChoix(m);
    else if(window.LNHQ_ALIGNEMENT){
      const j = joueurDeDetails(m);
      c = LNHQ_ALIGNEMENT.carte(j, j.poTexte);
      const infos = c.querySelector('.al-infos') || c;
      infos.prepend(el('span', 'ech-salaire' + (m.type === 'espoir' ? ' is-espoir' : ''), m.type === 'espoir' ? 'Hors masse' : m.salaire ? millions(m.salaire) : '—'));
    }else{
      c = el('div', 'al-carte', m.joueur);
      c.dataset.joueur = m.joueur;
    }
    // 3 équipes : d'où vient l'élément.
    if(plusieurs){
      const de = el('span', 'ech-de');
      const img = el('img');
      img.src = 'Logos/' + m.de + '.png';
      img.alt = '';
      de.append(el('span', null, 'de'), img);
      de.title = 'de ' + ((equipeDeCode.get(m.de) || {}).name || m.de);
      c.append(de);
    }
    return c;
  }

  function renderEchange(details){
    const equipes = [];
    details.forEach(m => { [m.de, m.vers].forEach(c => { if(!equipes.includes(c)) equipes.push(c); }); });
    const box = el('div', 'ech');
    box.dataset.details = JSON.stringify(details);
    equipes.forEach(code => {
      const recus = details.filter(m => m.vers === code);
      const bloc = el('section', 'ech-equipe');
      const [primaire, foncee] = COULEURS_EQUIPES[code] || ['#E8590C', '#1b1f24'];
      bloc.style.setProperty('--al-couleur', primaire);
      bloc.style.setProperty('--al-sombre', foncee);
      const h = el('h3', 'ech-titre');
      const logo = el('img');
      logo.src = 'Logos/' + code + '.png';
      logo.alt = '';
      h.append(logo, el('span', null, ((equipeDeCode.get(code) || {}).name || code) + ' reçoit'));
      const grille = el('div', 'al-cartes ech-cartes');
      recus.forEach(m => grille.append(carteEchange(m, equipes.length > 2)));
      if(!recus.length) grille.append(el('p', 'ech-rien', 'Rien'));
      bloc.append(h, grille);
      box.append(bloc);
    });
    return box;
  }

  async function gvizLignes(params){
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=1&${params}&t=${Date.now()}`);
    const m = (await res.text()).match(/setResponse\(([\s\S]*)\);\s*$/);
    const table = JSON.parse(m[1]).table;
    return { labels: table.cols.map(c => (c.label || '').trim()),
      lignes: table.rows.map(r => (r.c || []).map(c => c ? String(c.f != null ? c.f : (c.v != null ? c.v : '')).trim() : '')) };
  }

  // Photo, drapeau, tir et taille des joueurs échangés, puis cartes redessinées.
  async function completerCartes(){
    const boites = [...els.list.querySelectorAll('.ech')];
    if(!boites.length || !window.LNHQ_ALIGNEMENT) return;
    const noms = new Set();
    boites.forEach(b => JSON.parse(b.dataset.details).forEach(m => { if(m.type !== 'choix' && !infosJoueurs.has(m.joueur)) noms.add(m.joueur); }));
    if(noms.size){
      try{
        const liste = [...noms].filter(n => !n.includes('"'));
        const q = encodeURIComponent('select A, B, C, H, J, K, L, AB, G where ' + liste.map(n => `B = "${n}"`).join(' or '));
        const [pdb, ids] = await Promise.all([gvizLignes('sheet=PLAYERSDATABASE&tq=' + q), chargementIds || (chargementIds = gvizLignes('sheet=IDS_LNH'))]);
        const numeros = ids.labels[0] === 'Joueur' ? new Map(ids.lignes.filter(l => /^\d{6,8}$/.test(l[1])).map(l => [l[0], l[1]])) : new Map();
        pdb.lignes.forEach(l => {
          if(!l[1] || infosJoueurs.has(l[1])) return;
          const v = l[1].indexOf(',');
          const pos = LNHQ_ALIGNEMENT.positions(l[3]);
          infosJoueurs.set(l[1], {
            id: l[1], prenom: v > 0 ? l[1].slice(v + 1).trim() : '', famille: v > 0 ? l[1].slice(0, v).trim() : l[1],
            nom: l[0] || l[1], ov: Number(l[2]) || 0, poTexte: pos.map(p => ETIQUETTES_PO[p] || p).join('/'),
            sh: (l[4] || '').toUpperCase(), ht: l[5] || '', wt: l[6] || '', espoir: /^(true|vrai|x|oui)$/i.test(l[7] || ''),
            pays: (l[8] || '').toUpperCase(), idLnh: numeros.get(l[1]) || '',
          });
        });
      }catch(e){ return; }   // cartes simples, sans photo
    }
    boites.forEach(b => {
      if(!b.isConnected) return;
      b.replaceWith(renderEchange(JSON.parse(b.dataset.details)));
    });
  }

  // Le contenu arrive après le chargement : le navigateur ne peut pas suivre seul
  // un lien vers #n-... (ex. le lien d'un message Discord).
  let scrolled = false;
  function scrollToHash(){
    if(scrolled || !location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    if(target){ target.scrollIntoView({ block: 'start' }); scrolled = true; }
  }

  async function load({ background = false } = {}){
    const numero = ++chargement;
    if(!background) show('loading');
    try{
      const res = await fetch(buildUrl());
      if(!res.ok) throw new Error('http_' + res.status);
      const match = (await res.text()).match(/setResponse\(([\s\S]*)\);\s*$/);
      if(!match) throw new Error('format_inattendu');
      const json = JSON.parse(match[1]);
      if(json.status === 'error') throw new Error('erreur_gviz');
      if(numero !== chargement) return;
      apply(json.table);
      try{ localStorage.setItem(CACHE_KEY, JSON.stringify({ table: json.table, ts: Date.now() })); }catch(e){}
      els.lastUpdated.textContent = 'Mis à jour à '
        + new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit' }).format(new Date());
      scrollToHash();
    }catch(err){
      console.error(err);
      if(!background && numero === chargement) show('error');
    }
  }

  els.retryBtn.addEventListener('click', () => load());

  // Affiche un fil : d'abord la copie gardée dans le navigateur, puis les données fraîches.
  function ouvrirFil(){
    onglets.forEach(b => b.setAttribute('aria-selected', String(b.dataset.fil === tab)));
    if(FILS[tab]) els.empty.textContent = FILS[tab].vide;
    let cached = null;
    try{ cached = JSON.parse(localStorage.getItem(CACHE_KEY)); }catch(e){}
    if(cached && cached.table){
      apply(cached.table);
      els.lastUpdated.textContent = 'Dernières données enregistrées — actualisation en cours…';
      scrollToHash();
      load({ background: true });
    }else{
      load();
    }
  }

  onglets.forEach(b => b.addEventListener('click', () => {
    if(b.dataset.fil === tab) return;
    tab = b.dataset.fil;
    noun = FILS[tab].nom;
    CACHE_KEY = 'feedCache_' + tab;
    const url = new URL(location.href);
    url.searchParams.set('fil', tab.toLowerCase());
    url.hash = '';
    history.replaceState(null, '', url);
    ouvrirFil();
  }));

  ouvrirFil();
})();
