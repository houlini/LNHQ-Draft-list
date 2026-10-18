/* LNHQ — carte de stats d'un joueur, au survol (ordinateur) ou au toucher (mobile).
   Tout élément portant data-joueur="Nom, Prénom" (colonne B de PLAYERSDATABASE) l'affiche :
   photo, équipe, position, OV, PJ · B · A · PTS · +/- · TG/M (onglet STATS_JOUEURS) et salaire.
   Les données sont chargées une seule fois, au premier survol. */
(function(){
  if(window.LNHQ_STATS_JOUEUR) return;
  const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';
  const STATS = [['pj', 'PJ'], ['b', 'B'], ['a', 'A'], ['p', 'PTS'], ['pm', '+/-'], ['tgm', 'TG/M']];
  // Entêtes de l'onglet STATS_JOUEURS → clés (lues par leur nom : l'ordre peut changer).
  const ENTETES = { 'Nom': 'nom', 'Équipe': 'equipe', 'PJ': 'pj', 'B': 'b', 'A': 'a', 'P': 'p', '+/-': 'pm', 'TG/M': 'tgm' };
  const PO = { C: 'C', LW: 'AG', RW: 'AD', LD: 'DG', RD: 'DD', D: 'D', G: 'G' };

  let donnees = null;   // Promise<{ stats: Map, infos: Map, ids: Map }>
  const tableau = params => fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=1&${params}`)
    .then(r => r.text()).then(t => JSON.parse(t.match(/setResponse\(([\s\S]*)\);\s*$/)[1]).table);
  const val = c => c && c.v != null ? String(c.v).trim() : '';
  function charger(){
    donnees ??= Promise.all([
      tableau('sheet=STATS_JOUEURS').catch(() => null),
      tableau('sheet=PLAYERSDATABASE&tq=' + encodeURIComponent("select B, C, H, N, Z where B <> '' and H <> 'CHOIX'")).catch(() => null),
      tableau('sheet=IDS_LNH').catch(() => null),
    ]).then(([st, pdb, ids]) => {
      const stats = new Map(), infos = new Map(), numeros = new Map();
      if(st){
        const cles = st.cols.map(c => ENTETES[(c.label || '').trim()]);
        st.rows.forEach(r => { const j = {}; cles.forEach((k, i) => { if(k) j[k] = val((r.c || [])[i]); }); if(j.nom) stats.set(j.nom, j); });
      }
      if(pdb) pdb.rows.forEach(r => { const c = r.c || []; const b = val(c[0]); if(b) infos.set(b, { ov: val(c[1]), po: val(c[2]), salaire: Number(c[3] && c[3].v) || 0, equipe: val(c[4]).toUpperCase() }); });
      if(ids && (ids.cols[0] || {}).label === 'Joueur') ids.rows.forEach(r => { const c = r.c || []; const n = val(c[0]), i = val(c[1]); if(n && /^\d{6,8}$/.test(i)) numeros.set(n, i); });
      return { stats, infos, ids: numeros };
    });
    return donnees;
  }

  // ---------- Style (jetons de site.css) ----------
  const style = document.createElement('style');
  style.textContent = `
    .sj-carte{ position:fixed; z-index:1000; width:min(290px, calc(100vw - 24px)); box-sizing:border-box; padding:12px 14px; border-radius:14px;
      background:var(--surface, #fff); color:var(--ink, #111); border:1px solid var(--line, #ddd); box-shadow:0 12px 32px rgba(0,0,0,0.28);
      font-family:'IBM Plex Sans', system-ui, sans-serif; font-size:13.5px; opacity:0; transform:translateY(4px); transition:opacity .12s, transform .12s; pointer-events:auto; }
    .sj-carte.is-visible{ opacity:1; transform:none; }
    .sj-haut{ display:flex; align-items:center; gap:10px; }
    .sj-photo{ width:54px; height:54px; flex-shrink:0; border-radius:50%; object-fit:cover; object-position:top; background:var(--stripe, #eee); border:2px solid var(--accent, #0a3); }
    .sj-nom{ flex:1; min-width:0; }
    .sj-nom b{ display:block; font-size:15.5px; line-height:1.2; }
    .sj-nom small{ display:flex; align-items:center; gap:5px; margin-top:3px; color:var(--ink-muted, #666); font-size:12.5px; }
    .sj-nom small img{ width:18px; height:18px; object-fit:contain; }
    .sj-ov{ flex-shrink:0; font-family:'Oswald', sans-serif; font-size:24px; line-height:1; color:var(--accent, #0a3); text-align:center; }
    .sj-ov small{ display:block; font-family:'IBM Plex Sans', sans-serif; font-size:10px; color:var(--ink-muted, #666); }
    .sj-stats{ display:grid; grid-template-columns:repeat(6, 1fr); margin:10px 0 0; padding:8px 0 0; border-top:1px solid var(--line, #ddd); text-align:center; }
    .sj-stats dt{ font-size:10.5px; text-transform:uppercase; letter-spacing:0.04em; color:var(--ink-muted, #666); }
    .sj-stats dd{ margin:2px 0 0; font-family:'IBM Plex Mono', monospace; font-weight:700; font-size:14px; }
    .sj-vide{ margin:10px 0 0; padding-top:8px; border-top:1px solid var(--line, #ddd); color:var(--ink-muted, #666); }
    .sj-bas{ display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:8px; font-size:12.5px; color:var(--ink-muted, #666); }
    .sj-bas a{ color:var(--accent, #0a3); font-weight:700; text-decoration:none; }
    .sj-bas a:hover{ text-decoration:underline; }
    [data-joueur]{ cursor:help; }
    @media (prefers-reduced-motion: reduce){ .sj-carte{ transition:none; } }`;
  document.head.append(style);

  // ---------- Carte ----------
  const el = (tag, cls, text) => { const e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; };
  const prenomNom = b => { const v = b.indexOf(','); return v > 0 ? b.slice(v + 1).trim() + ' ' + b.slice(0, v).trim() : b; };
  const millions = n => (n / 1e6).toLocaleString('fr-CA', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' M$';
  const equipes = () => new Map((window.LNHQ_TEAMS || []).map(t => [t.code, t]));
  let carte = null, cible = null, minuterie = 0;

  function contenu(id, d){
    const info = d.infos.get(id) || {}, st = d.stats.get(id), eq = equipes().get(info.equipe);
    const c = el('div', 'sj-carte'); c.setAttribute('role', 'tooltip');
    const haut = el('div', 'sj-haut');
    const photo = el('img', 'sj-photo'); photo.alt = '';
    const num = d.ids.get(id);
    photo.src = num ? `https://assets.nhle.com/mugs/nhl/latest/${num}.png` : eq ? 'Logos/' + info.equipe + '.png' : 'logo-lnhq.png';
    photo.onerror = () => { photo.onerror = null; photo.src = 'logo-lnhq.png'; };
    const nom = el('div', 'sj-nom'); nom.append(el('b', null, prenomNom(id)));
    const sous = el('small');
    if(eq){ const l = el('img'); l.src = 'Logos/' + info.equipe + '.png'; l.alt = ''; sous.append(l); }
    const po = String(info.po || '').split('/').map(p => PO[p.trim().toUpperCase()] || p.trim()).filter(Boolean).join('/');
    sous.append(document.createTextNode([eq ? eq.name : info.equipe === 'UFA' ? 'Agent libre' : '', po].filter(Boolean).join(' · ')));
    nom.append(sous);
    haut.append(photo, nom);
    if(info.ov){ const ov = el('div', 'sj-ov', info.ov); ov.append(el('small', null, 'OV')); haut.append(ov); }
    c.append(haut);
    if(st && st.pj && st.pj !== '0'){
      const dl = el('dl', 'sj-stats');
      STATS.forEach(([k, t]) => { const g = el('div'); g.append(el('dt', null, t), el('dd', null, k === 'pm' && Number(st.pm) > 0 ? '+' + st.pm : (st[k] || '–'))); dl.append(g); });
      c.append(dl);
    }else c.append(el('p', 'sj-vide', 'Aucun match joué cette saison.'));
    const bas = el('div', 'sj-bas');
    bas.append(el('span', null, info.salaire ? millions(info.salaire) + ' (2026-27)' : ''));
    const lien = el('a', null, 'Toutes ses stats →'); lien.href = 'stats.html?joueur=' + encodeURIComponent(id);
    bas.append(lien);
    c.append(bas);
    return c;
  }

  function placer(){
    if(!carte || !cible) return;
    const r = cible.getBoundingClientRect(), h = carte.offsetHeight, w = carte.offsetWidth, m = 8;
    const dessous = r.bottom + m + h <= innerHeight || r.top - m - h < 0;
    carte.style.top = Math.max(m, dessous ? r.bottom + m : r.top - m - h) + 'px';
    carte.style.left = Math.min(Math.max(m, r.left + r.width / 2 - w / 2), innerWidth - w - m) + 'px';
  }
  async function montrer(elem){
    clearTimeout(minuterie);
    if(cible === elem && carte) return;
    cacher();
    cible = elem;
    const d = await charger();
    if(cible !== elem) return;   // la souris est déjà partie ailleurs
    carte = contenu(elem.dataset.joueur, d);
    carte.addEventListener('pointerenter', () => clearTimeout(minuterie));
    carte.addEventListener('pointerleave', e => { if(e.pointerType === 'mouse') cacherBientot(); });
    document.body.append(carte);
    placer();
    requestAnimationFrame(() => carte && carte.classList.add('is-visible'));
  }
  function cacher(){ clearTimeout(minuterie); if(carte) carte.remove(); carte = null; cible = null; }
  function cacherBientot(){ clearTimeout(minuterie); minuterie = setTimeout(cacher, 180); }

  // ---------- Événements (délégués : marche aussi pour le contenu ajouté plus tard) ----------
  const joueurDe = t => t && t.closest ? t.closest('[data-joueur]') : null;
  document.addEventListener('pointerover', e => {
    if(e.pointerType !== 'mouse') return;
    const j = joueurDe(e.target);
    if(j){ charger(); clearTimeout(minuterie); if(j !== cible) minuterie = setTimeout(() => montrer(j), 220); }
  });
  document.addEventListener('pointerout', e => {
    if(e.pointerType !== 'mouse') return;
    const j = joueurDe(e.target);
    if(j && !j.contains(e.relatedTarget) && !(carte && carte.contains(e.relatedTarget))) cacherBientot();
  });
  // Toucher : ouvre (ou ferme) la carte ; toucher ailleurs la ferme.
  let dernierPointeur = 'mouse';
  document.addEventListener('pointerdown', e => { dernierPointeur = e.pointerType; }, true);
  document.addEventListener('click', e => {
    if(carte && carte.contains(e.target)) return;
    const j = joueurDe(e.target);
    if(dernierPointeur !== 'mouse' && j && !e.target.closest('a, button, input, select')){
      if(cible === j && carte) cacher(); else montrer(j);
      return;
    }
    if(carte) cacher();
  });
  document.addEventListener('keydown', e => { if(e.key === 'Escape') cacher(); });
  addEventListener('scroll', () => { if(dernierPointeur === 'mouse') cacher(); else placer(); }, true);
  addEventListener('resize', placer);

  window.LNHQ_STATS_JOUEUR = { charger };
})();
