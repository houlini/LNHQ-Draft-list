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
    const texte = renderText(n.texte);
    const suite = el('button', 'news-more', 'Lire la suite');
    suite.type = 'button';
    suite.hidden = true;
    suite.addEventListener('click', () => {
      const replie = texte.classList.toggle('is-collapsed');
      suite.textContent = replie ? 'Lire la suite' : 'Réduire';
      if(replie) card.scrollIntoView({ block: 'nearest' });
    });
    body.append(meta, el('h2', 'news-title', n.titre), texte, suite);

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
    const long = texte.scrollHeight > HAUTEUR_REPLI + 120;
    texte.classList.toggle('is-collapsed', long && !cible);
    suite.hidden = !long;
    suite.textContent = long && !cible ? 'Lire la suite' : 'Réduire';
  }

  function preparerReplis(){
    els.list.querySelectorAll('.news-card').forEach(card => {
      replier(card);
      card.querySelector('.news-more').addEventListener('click', e => { e.currentTarget.dataset.ouvert = '1'; });
      card.querySelectorAll('.news-text img').forEach(img => img.addEventListener('load', () => replier(card)));
    });
  }

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
