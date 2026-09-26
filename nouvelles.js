/* =========================================================================
   LNHQ — fil de nouvelles / annonces, lu dans un onglet du classeur rempli par
   le script du Google Form (apps-script/nouvelles.gs). Réglé par les attributs
   de <main id="feed"> : data-tab (onglet), data-form-url, data-noun.
   ========================================================================= */
(function(){
  const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';
  const HEADERS = ['Date', 'Équipe', 'Type', 'Titre', 'Texte', 'Photos', 'Visible', 'Épinglé'];
  const TYPE_CLASS = {
    'Transaction': 'type-transaction',
    'Résultat': 'type-resultat',
    'Blessure': 'type-blessure',
    'Général': 'type-general',
  };
  const DRIVE_ID = /^[A-Za-z0-9_-]{20,}$/;

  const feed = document.getElementById('feed');
  const tab = feed.dataset.tab;
  const noun = feed.dataset.noun || 'nouvelle';
  const CACHE_KEY = 'feedCache_' + tab;
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

  // Le Form Nouvelles est ouvert à tous : le HTML produit par le Markdown est
  // nettoyé par DOMPurify avant d'être inséré. Sans les deux bibliothèques
  // (CDN inaccessible), on affiche le texte brut plutôt que du HTML non nettoyé.
  function renderText(text){
    const box = el('div', 'news-text');
    if(window.marked && window.DOMPurify){
      box.innerHTML = DOMPurify.sanitize(marked.parse(text));
      box.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
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
    body.append(meta, el('h2', 'news-title', n.titre), renderText(n.texte));

    if(n.photos.length > 1){
      const gallery = el('div', 'news-gallery');
      n.photos.slice(1).forEach(id => gallery.append(photoLink(id, null, 400)));
      body.append(gallery);
    }
    card.append(body);
    return card;
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
    if(!background) show('loading');
    try{
      const res = await fetch(buildUrl());
      if(!res.ok) throw new Error('http_' + res.status);
      const match = (await res.text()).match(/setResponse\(([\s\S]*)\);\s*$/);
      if(!match) throw new Error('format_inattendu');
      const json = JSON.parse(match[1]);
      if(json.status === 'error') throw new Error('erreur_gviz');
      apply(json.table);
      try{ localStorage.setItem(CACHE_KEY, JSON.stringify({ table: json.table, ts: Date.now() })); }catch(e){}
      els.lastUpdated.textContent = 'Mis à jour à '
        + new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit' }).format(new Date());
      scrollToHash();
    }catch(err){
      console.error(err);
      if(!background) show('error');
    }
  }

  els.retryBtn.addEventListener('click', () => load());

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
})();
