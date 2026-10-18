/* LNHQ — import des stats de joueurs (publier.lnhq.ca/stats-import.html, dirigeants).
   Bientôt une section de la page « Gestion Admin ». Le CSV (export du jeu, lu par Google)
   est vérifié ici avant l'import :
     - arithmétique : P = B + A, %T = B / T, BAN + BIN ≤ B, BG ≤ B ;
     - noms : « Z. Werenski » doit exister dans PLAYERSDATABASE (nom + initiale) ; sinon,
       suggestions par nom de famille ;
     - équipes : PJ ≤ matchs de l'équipe ; totaux du CSV ≤ résultats réels (onglet RESULTATS),
       en retirant le but de fusillade (TB) : il n'est attribué à personne et ne fait pas de BG.
   Une colonne incohérente est décochée d'office. Le script revérifie la forme et remplace
   l'onglet public STATS_JOUEURS. */
(function(){
  const $ = id => document.getElementById(id);
  const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';

  // Colonnes : clé interne, entêtes acceptées (export du jeu ou français), libellé.
  const COLONNES = [
    { cle: 'joueur', entetes: ['PLAYER', 'JOUEUR'], nom: 'Joueur', fixe: true },
    { cle: 'po', entetes: ['POS', 'PO', 'POSITION'], nom: 'PO', fixe: true },
    { cle: 'pj', entetes: ['GP', 'PJ'], nom: 'PJ' },
    { cle: 'b', entetes: ['G', 'B', 'BUTS'], nom: 'B' },
    { cle: 'a', entetes: ['A', 'PASSES'], nom: 'A' },
    { cle: 'p', entetes: ['P', 'PTS', 'POINTS'], nom: 'P' },
    { cle: 'pm', entetes: ['+/-', 'PM', 'DIFF'], nom: '+/-' },
    { cle: 'pun', entetes: ['PIM', 'PUN', 'MIN'], nom: 'PUN' },
    { cle: 't', entetes: ['S', 'SOG', 'T', 'TIRS'], nom: 'T' },
    { cle: 'pct', entetes: ['S%', '%T', 'SH%'], nom: '%T' },
    { cle: 'bg', entetes: ['GWG', 'BG'], nom: 'BG' },
    { cle: 'ban', entetes: ['PPG', 'BAN'], nom: 'BAN' },
    { cle: 'bin', entetes: ['SHG', 'BIN'], nom: 'BIN' },
  ];
  const NOMBRES = ['pj', 'b', 'a', 'p', 'pm', 'pun', 't', 'bg', 'ban', 'bin'];

  let roster = [];            // { b: 'Nom, Prénom', po, equipe }
  let equipes = {};           // code → { pj, bp, v, ban, binf, tb }
  let joueurs = [];           // lignes du CSV (+ correspondance)
  let inclure = {};           // cle → bool (colonne importée)
  let envoi = false;

  function el(tag, cls, text){ const e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }
  function afficher(texte, type){ const m = $('message'); m.className = 'si-message ' + (type || ''); m.textContent = texte; m.hidden = !texte; }
  const sansAccents = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const logo = c => { const i = el('img', 'si-logo'); i.src = 'https://lnhq.ca/Logos/' + c + '.png'; i.alt = ''; i.onerror = () => i.remove(); return i; };

  async function gviz(params){
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=1&${params}&t=${Date.now()}`);
    return JSON.parse((await res.text()).match(/setResponse\(([\s\S]*)\);\s*$/)[1]).table;
  }
  const val = c => c && c.v != null ? String(c.v) : '';

  async function chargerReferences(){
    const [pdb, res] = await Promise.all([
      gviz('sheet=PLAYERSDATABASE&tq=' + encodeURIComponent("select B, H, Z where Z <> '' and H <> 'CHOIX'")),
      gviz('sheet=RESULTATS'),
    ]);
    roster = pdb.rows.map(r => ({ b: val(r.c[0]).trim(), po: val(r.c[1]), equipe: val(r.c[2]).toUpperCase() })).filter(x => x.b && x.b.includes(','));
    const lab = res.cols.map(c => c.label);
    const iAN = lab.indexOf('Avantages num. V'), iBin = lab.indexOf('Buts inf. V');
    equipes = {};
    const ajout = (c, k, n) => { (equipes[c] ??= { pj: 0, bp: 0, v: 0, ban: 0, binf: 0, tb: 0 })[k] += n; };
    const an = s => { const m = /^(\d+)\s*\/\s*\d+/.exec(s || ''); return m ? +m[1] : 0; };
    res.rows.forEach(r => {
      const c = r.c || [];
      const V = val(c[2]).toUpperCase(), D = val(c[3]).toUpperCase(), bv = Number(val(c[4])), bd = Number(val(c[5]));
      if(!V || !D || isNaN(bv) || isNaN(bd)) return;
      const tb = val(c[6]).toUpperCase() === 'TB', g = bv > bd ? V : D;
      ajout(V, 'pj', 1); ajout(D, 'pj', 1);
      // Le « but » de fusillade du gagnant n'est attribué à aucun joueur.
      ajout(V, 'bp', bv - (tb && g === V ? 1 : 0)); ajout(D, 'bp', bd - (tb && g === D ? 1 : 0));
      ajout(g, tb ? 'tb' : 'v', 1);
      if(iAN >= 0){ ajout(V, 'ban', an(val(c[iAN]))); ajout(D, 'ban', an(val(c[iAN + 1]))); }
      if(iBin >= 0){ ajout(V, 'binf', Number(val(c[iBin])) || 0); ajout(D, 'binf', Number(val(c[iBin + 1])) || 0); }
    });
  }

  // CSV simple (virgules, guillemets possibles).
  function lireCsv(texte){
    const lignes = [];
    texte.replace(/^﻿/, '').split(/\r?\n/).forEach(l => {
      if(!l.trim()) return;
      const v = []; let cur = '', q = false;
      for(let i = 0; i < l.length; i++){
        const ch = l[i];
        if(q){ if(ch === '"' && l[i + 1] === '"'){ cur += '"'; i++; } else if(ch === '"') q = false; else cur += ch; }
        else if(ch === '"') q = true; else if(ch === ',' || ch === ';'){ v.push(cur); cur = ''; } else cur += ch;
      }
      v.push(cur);
      lignes.push(v.map(x => x.trim()));
    });
    return lignes;
  }

  /* ---------- Vérification ---------- */
  function analyser(texte){
    const lignes = lireCsv(texte);
    if(lignes.length < 2) throw new Error('Le CSV est vide ou n’a qu’une ligne d’entêtes.');
    const entetes = lignes[0].map(h => h.toUpperCase());
    const index = {};
    COLONNES.forEach(c => { const i = entetes.findIndex(h => c.entetes.includes(h)); if(i >= 0) index[c.cle] = i; });
    if(index.joueur == null) throw new Error('Colonne PLAYER (joueur) introuvable dans les entêtes.');
    const absentes = COLONNES.filter(c => index[c.cle] == null).map(c => c.nom);
    joueurs = lignes.slice(1).map((v, n) => {
      const j = { ligne: n + 2, erreurs: [] };
      COLONNES.forEach(c => { j[c.cle] = index[c.cle] != null ? (v[index[c.cle]] || '') : ''; });
      j.pct = j.pct.replace(',', '.');
      NOMBRES.forEach(k => { if(j[k] !== '' && isNaN(Number(j[k]))) j.erreurs.push(`${k.toUpperCase()} « ${j[k]} » n’est pas un nombre`); });
      return j;
    }).filter(j => j.joueur);
    // Noms → PLAYERSDATABASE (nom de famille + initiale du prénom).
    joueurs.forEach(j => {
      const point = j.joueur.indexOf('.');
      const ini = point > 0 ? sansAccents(j.joueur.slice(0, point)) : '';
      const famille = sansAccents(point > 0 ? j.joueur.slice(point + 1) : j.joueur);
      const memeNom = roster.filter(r => sansAccents(r.b.split(',')[0]) === famille);
      const exacts = memeNom.filter(r => !ini || sansAccents(r.b.split(',')[1]).startsWith(ini));
      j.suggestions = exacts.length === 1 ? exacts : memeNom;
      j.choix = exacts.length === 1 ? exacts[0] : null;
    });
    const doublons = joueurs.map(j => sansAccents(j.joueur)).filter((n, i, a) => a.indexOf(n) !== i);
    // Colonnes incohérentes : décochées d'office.
    inclure = {};
    COLONNES.forEach(c => { inclure[c.cle] = index[c.cle] != null; });
    return { absentes, doublons };
  }

  // Problèmes par ligne et par équipe (recalculés quand on rattache un joueur).
  function verifier(){
    const pb = { ligne: [], equipe: [], colonnes: {} };
    const note = (cle, txt) => { (pb.colonnes[cle] ??= []).push(txt); };
    joueurs.forEach(j => {
      j.alertes = [...j.erreurs];
      const n = k => Number(j[k]) || 0;
      if(j.b !== '' && j.a !== '' && j.p !== '' && n('b') + n('a') !== n('p')){ j.alertes.push(`B ${j.b} + A ${j.a} ≠ P ${j.p}`); note('p', j.joueur); }
      if(j.t !== '' && j.pct !== '' && n('t') > 0){ const calc = Math.round(1000 * n('b') / n('t')) / 10; if(Math.abs(calc - parseFloat(j.pct)) > 0.15){ j.alertes.push(`%T ${j.pct} ≠ ${j.b}/${j.t} = ${calc}%`); note('pct', j.joueur); } }
      if(n('ban') > n('b')){ j.alertes.push(`BAN ${j.ban} > B ${j.b}`); note('ban', j.joueur); }
      if(n('bin') > n('b')){ j.alertes.push(`BIN ${j.bin} > B ${j.b}`); note('bin', j.joueur); }
      if(n('ban') + n('bin') > n('b') && n('ban') <= n('b') && n('bin') <= n('b')){ j.alertes.push(`BAN + BIN > B`); note('bin', j.joueur); }
      if(n('bg') > n('b')){ j.alertes.push(`BG ${j.bg} > B ${j.b}`); note('bg', j.joueur); }
      const e = j.choix && equipes[j.choix.equipe];
      if(e && n('pj') > e.pj) j.alertes.push(`PJ ${j.pj} > matchs de ${j.choix.equipe} au classeur (${e.pj})`);
      if(!j.choix) j.alertes.push(j.suggestions.length ? 'Nom à rattacher' : 'Introuvable dans PLAYERSDATABASE');
    });
    const parEquipe = {};
    joueurs.forEach(j => { if(j.choix && equipes[j.choix.equipe]) (parEquipe[j.choix.equipe] ??= []).push(j); });
    Object.entries(parEquipe).sort().forEach(([c, js]) => {
      const s = k => js.reduce((t, j) => t + (Number(j[k]) || 0), 0), r = equipes[c];
      const ajout = (cle, txt) => { pb.equipe.push(c + ' : ' + txt); note(cle, c); };
      const pl = (n, mot) => n + ' ' + mot + (n > 1 ? 's' : '');
      if(s('b') > r.bp) ajout('b', `${pl(s('b'), 'but')} au CSV > ${pl(r.bp, 'but')} de l’équipe (hors fusillade)`);
      if(s('ban') > r.ban) ajout('ban', `${pl(s('ban'), 'but')} en avantage > ${r.ban}`);
      if(s('bin') > r.binf) ajout('bin', `${pl(s('bin'), 'but')} en infériorité > ${r.binf}`);
      if(s('bg') > r.v) ajout('bg', `${pl(s('bg'), 'but')} gagnant${s('bg') > 1 ? 's' : ''} > ${pl(r.v, 'victoire')} hors TB`);
    });
    // Une colonne est « incohérente » si elle échoue pour plus de 10 % des joueurs ou pour au moins
    // 3 équipes (un petit écart isolé peut venir d'un match pas encore soumis).
    const equipesEnEchec = k => (pb.colonnes[k] || []).filter(x => /^[A-Z]{3}$/.test(x)).length;
    pb.incoherentes = Object.keys(pb.colonnes).filter(k => (pb.colonnes[k].length - equipesEnEchec(k)) > Math.max(2, joueurs.length * 0.1) || equipesEnEchec(k) >= 3);
    return pb;
  }

  /* ---------- Rendu du rapport ---------- */
  let dernierPb = null;
  function rendre(premiereFois){
    const pb = verifier();
    dernierPb = pb;
    if(premiereFois) pb.incoherentes.forEach(k => { if(inclure[k]) inclure[k] = false; });
    const nbAlertes = joueurs.filter(j => j.alertes.length).length;
    const aRattacher = joueurs.filter(j => !j.choix).length;
    const tuile = (lib, val, cls) => { const t = el('div', 'si-tuile ' + (cls || '')); t.append(el('small', null, lib), el('strong', null, String(val))); return t; };
    $('tuiles').replaceChildren(tuile('Joueurs', joueurs.length), tuile('Lignes avec alerte', nbAlertes, nbAlertes ? 'is-alerte' : 'is-ok'),
      tuile('À rattacher', aRattacher, aRattacher ? 'is-alerte' : 'is-ok'), tuile('Colonnes incohérentes', pb.incoherentes.length, pb.incoherentes.length ? 'is-erreur' : 'is-ok'));
    // Colonnes
    $('colonnes').replaceChildren(...COLONNES.filter(c => !c.fixe).map(c => {
      const l = el('label', 'si-colonne' + (pb.incoherentes.includes(c.cle) ? ' is-incoherente' : ''));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!inclure[c.cle]; cb.disabled = !joueurs.some(j => j[c.cle] !== '');
      cb.addEventListener('change', () => { inclure[c.cle] = cb.checked; rendre(false); });
      const n = (pb.colonnes[c.cle] || []).length;
      l.append(cb, el('b', null, c.nom), el('small', null, cb.disabled ? 'absente' : pb.incoherentes.includes(c.cle) ? `⚠ incohérente (${n})` : n ? `${n} alerte(s)` : '✓'));
      return l;
    }));
    // Noms à rattacher
    const aFaire = joueurs.filter(j => !j.choix || j.choixManuel);
    $('blocNoms').hidden = !aFaire.length;
    $('noms').replaceChildren(...aFaire.map(j => {
      const r = el('div', 'si-nom');
      r.append(el('b', null, j.joueur), el('span', null, j.po));
      const sel = el('select');
      sel.append(new Option('— garder sans équipe —', ''));
      const cands = j.suggestions.length ? j.suggestions : [];
      cands.forEach((c, i) => sel.append(new Option(`${c.b.split(',').reverse().join(' ').trim()} · ${c.po} · ${c.equipe || '—'}`, String(i))));
      if(j.choix) sel.value = String(cands.indexOf(j.choix));
      if(!cands.length) sel.append(new Option('(aucun joueur de ce nom au classeur)', '', false, false));
      sel.addEventListener('change', () => { j.choix = sel.value === '' ? null : cands[Number(sel.value)]; j.choixManuel = true; rendre(false); });
      r.append(sel);
      if(cands.length === 1 && !j.choix) r.append(el('small', null, 'Suggestion : ' + cands[0].b.split(',').reverse().join(' ').trim() + ' (initiale différente)'));
      return r;
    }));
    // Incohérences
    const blocs = [];
    if(pb.equipe.length){ const d = el('div', 'si-groupe'); d.append(el('h4', null, 'Totaux d’équipe impossibles (comparés aux résultats)')); const ul = el('ul'); pb.equipe.forEach(t => ul.append(el('li', null, t))); d.append(ul); blocs.push(d); }
    const lignesPb = joueurs.filter(j => j.alertes.some(a => a !== 'Nom à rattacher' && a !== 'Introuvable dans PLAYERSDATABASE'));
    if(lignesPb.length){ const d = el('div', 'si-groupe'); d.append(el('h4', null, `Joueurs avec une alerte (${lignesPb.length})`)); const ul = el('ul'); lignesPb.forEach(j => ul.append(el('li', null, `L${j.ligne} ${j.joueur} : ${j.alertes.filter(a => !/rattacher|Introuvable/.test(a)).join(' · ')}`))); d.append(ul); blocs.push(d); }
    $('blocProblemes').hidden = !blocs.length;
    $('problemes').replaceChildren(...blocs);
    // Aperçu
    const cols = COLONNES.filter(c => c.fixe || inclure[c.cle]);
    const thead = el('thead'), tr = el('tr');
    tr.append(el('th', null, ''), el('th', null, 'Équipe'), ...cols.map(c => el('th', null, c.nom)));
    thead.append(tr);
    const tbody = el('tbody');
    joueurs.forEach(j => {
      const r = el('tr', j.alertes.length ? 'is-alerte' : '');
      const etat = el('td', 'etat', j.alertes.length ? '⚠' : '✓'); etat.title = j.alertes.join('\n') || 'Aucune alerte';
      const eqTd = el('td'); if(j.choix && j.choix.equipe && j.choix.equipe !== 'UFA') eqTd.append(logo(j.choix.equipe), document.createTextNode(j.choix.equipe)); else eqTd.textContent = j.choix ? 'UFA' : '—';
      r.append(etat, eqTd, ...cols.map(c => el('td', NOMBRES.includes(c.cle) ? 'num' : '', j[c.cle])));
      tbody.append(r);
    });
    $('apercu').replaceChildren(thead, tbody);
    $('compteApercu').textContent = `${joueurs.length} joueurs · ${cols.length - 2} colonnes de stats`;
    $('importer').textContent = `Importer ${joueurs.length} joueurs`;
    $('aideImporter').textContent = (pb.incoherentes.some(k => inclure[k]) ? '⚠ Une colonne incohérente est cochée. ' : '') + 'L’import remplace la liste publiée sur lnhq.ca/stats.html.';
    $('rapport').hidden = false;
  }

  async function traiter(texte){
    afficher('Vérification en cours…', '');
    try{
      if(!roster.length) await chargerReferences();
      const info = analyser(texte);
      rendre(true);
      const msgs = [];
      if(info.absentes.length) msgs.push('Colonnes absentes : ' + info.absentes.join(', '));
      if(info.doublons.length) msgs.push('Doublons : ' + [...new Set(info.doublons)].join(', '));
      afficher(msgs.join(' · ') || `${joueurs.length} joueurs lus. Vérifie le rapport, puis importe.`, msgs.length ? 'is-alerte' : 'is-ok');
    }catch(err){
      $('rapport').hidden = true;
      afficher(err.message || 'Impossible de lire ce fichier.', 'is-erreur');
    }
  }

  async function importer(){
    if(envoi || !joueurs.length) return;
    if(dernierPb && dernierPb.incoherentes.some(k => inclure[k]) && !confirm('Une colonne incohérente est cochée. Importer quand même ?')) return;
    if(!confirm(`Remplacer les stats publiées par ces ${joueurs.length} joueurs ?`)) return;
    envoi = true;
    const b = $('importer'); b.disabled = true; b.textContent = 'Import…';
    const lignes = joueurs.map(j => {
      const o = { joueur: j.joueur, nom: j.choix ? j.choix.b : '', equipe: j.choix && j.choix.equipe !== 'UFA' ? j.choix.equipe : '', po: j.po };
      COLONNES.filter(c => !c.fixe).forEach(c => { o[c.cle] = inclure[c.cle] ? j[c.cle] : ''; });
      return o;
    });
    let r;
    try{ r = await (await fetch('/api/stats/importer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lignes }) })).json(); }
    catch(e){ r = { ok: false, erreur: 'session' }; }
    envoi = false; b.disabled = false; b.textContent = `Importer ${joueurs.length} joueurs`;
    if(r.ok) afficher(`✓ ${r.joueurs} joueurs importés. Ils sont sur lnhq.ca/stats.html (une minute peut être nécessaire).`, 'is-ok');
    else afficher({ admin: 'Seul un dirigeant peut importer les stats.', nombre: `Valeur non numérique pour ${r.joueur} (${r.colonne}).`, session: 'Ta session a peut-être expiré : recharge la page.' }[r.erreur] || 'L’import a échoué. Réessaie dans un instant.', 'is-erreur');
  }

  async function demarrer(){
    let moi;
    try{ moi = await (await fetch('/api/moi')).json(); }catch(e){ moi = { ok: false }; }
    if(!moi.ok || !moi.annonces){
      $('qui').textContent = '';
      $('refusTexte').textContent = moi.ok ? 'Cette page est réservée aux dirigeants de la ligue.' : 'Accès impossible : recharge la page pour te reconnecter.';
      $('refus').hidden = false;
      return;
    }
    $('qui').textContent = 'Gestion admin · ' + (moi.equipe || 'Ligue');
    $('contenu').hidden = false;
    const lireFichier = f => { const lecteur = new FileReader(); lecteur.onload = () => traiter(String(lecteur.result)); lecteur.readAsText(f, 'utf-8'); };
    $('fichier').addEventListener('change', () => { if($('fichier').files[0]) lireFichier($('fichier').files[0]); });
    const depot = $('depot');
    ['dragenter', 'dragover'].forEach(t => depot.addEventListener(t, ev => { ev.preventDefault(); depot.classList.add('is-survol'); }));
    ['dragleave', 'drop'].forEach(t => depot.addEventListener(t, ev => { ev.preventDefault(); depot.classList.remove('is-survol'); }));
    depot.addEventListener('drop', ev => { const f = ev.dataTransfer.files[0]; if(f) lireFichier(f); });
    $('verifierTexte').addEventListener('click', () => traiter($('texte').value));
    $('importer').addEventListener('click', importer);
  }
  demarrer();
})();
