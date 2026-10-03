/* =========================================================================
   LNHQ — résultats des matchs : données partagées (Calendrier, Classement et
   page de soumission de publier.lnhq.ca). Un DG soumet la photo de l'écran de
   fin de match ; le script écrit une ligne dans l'onglet RESULTATS (une par
   match) et le score dans SCHEDULE (F = visiteur, G = domicile).
   ========================================================================= */
(function(){
  const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';

  // Les 9 lignes de l'écran « Home » de fin de match, dans l'ordre du jeu.
  const STATS = [
    { cle: 'tirs', nom: 'Tirs', jeu: 'TOTAL SHOTS' },
    { cle: 'mises', nom: 'Mises en échec', jeu: 'HITS' },
    { cle: 'attaque', nom: "Temps d'attaque", jeu: 'TIME ON ATTACK' },
    { cle: 'passes', nom: 'Passes réussies', jeu: 'PASSING' },
    { cle: 'engagements', nom: 'Mises au jeu gagnées', jeu: 'FACEOFFS WON' },
    { cle: 'penalites', nom: 'Minutes de pénalité', jeu: 'PENALTY MINUTES' },
    { cle: 'avantages', nom: 'Avantages numériques', jeu: 'POWERPLAYS' },
    { cle: 'minAvantage', nom: 'Minutes en avantage', jeu: 'POWERPLAY MINUTES' },
    { cle: 'inferiorite', nom: 'Buts en infériorité', jeu: 'SHORTHANDED GOALS' },
  ];
  const FINS = { '': '', PROL: 'Prol.', TB: 'T.B.' };

  // Alignement de la LNH : 2 conférences de 2 divisions de 8 équipes.
  const CONFERENCES = [
    { nom: 'Conférence de l’Est', divisions: [
      { nom: 'Division Atlantique', equipes: ['BOS', 'BUF', 'DET', 'FLA', 'MTL', 'OTT', 'TBL', 'TOR'] },
      { nom: 'Division Métropolitaine', equipes: ['CAR', 'CBJ', 'NJD', 'NYI', 'NYR', 'PHI', 'PIT', 'WSH'] },
    ] },
    { nom: 'Conférence de l’Ouest', divisions: [
      { nom: 'Division Centrale', equipes: ['CHI', 'COL', 'DAL', 'MIN', 'NSH', 'STL', 'UTA', 'WPG'] },
      { nom: 'Division Pacifique', equipes: ['ANA', 'CGY', 'EDM', 'LAK', 'SJS', 'SEA', 'VAN', 'VGK'] },
    ] },
  ];

  async function gviz(params){
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&${params}&t=${Date.now()}`, { cache: 'no-store' });
    if(!res.ok) throw new Error('http_' + res.status);
    const m = (await res.text()).match(/setResponse\(([\s\S]*)\);\s*$/);
    if(!m) throw new Error('format_inattendu');
    const json = JSON.parse(m[1]);
    if(json.status === 'error') throw new Error('erreur_gviz');
    const lignes = json.table.rows.map(r => (r.c || []).map(c => c ? String(c.f != null ? c.f : (c.v != null ? c.v : '')).trim() : ''));
    lignes.entetes = json.table.cols.map(c => (c.label || '').trim());
    return lignes;
  }

  // { '12': { match, date, visiteur, domicile, butsV, butsD, fin, stats: { tirs: ['31','25'], … }, photo } }
  async function chargerResultats(){
    let lignes;
    try{ lignes = await gviz('sheet=RESULTATS&headers=1'); }catch(e){ return {}; }
    // Onglet absent : l'API renvoie en silence le 1er onglet ; on vérifie l'en-tête.
    if(lignes.entetes[0] !== 'Match' || lignes.entetes[4] !== 'Buts V') return {};
    const res = {};
    lignes.forEach(l => {
      const butsV = Number(l[4]), butsD = Number(l[5]);
      if(!l[0] || l[4] === '' || l[5] === '' || isNaN(butsV) || isNaN(butsD)) return;
      const stats = {};
      STATS.forEach((s, i) => { stats[s.cle] = [l[7 + i * 2] || '', l[8 + i * 2] || '']; });
      res[l[0]] = { match: l[0], date: l[1], visiteur: (l[2] || '').toUpperCase(), domicile: (l[3] || '').toUpperCase(),
        butsV, butsD, fin: FINS[l[6]] != null ? l[6] : '', stats, photo: l[7 + STATS.length * 2] || '' };
    });
    return res;
  }

  // Classement (règles de la LNH) : victoire = 2 pts, défaite en prolongation ou
  // aux tirs de barrage = 1 pt. Égalités : points, victoires, différentiel, buts pour.
  function classement(resultats, codes){
    const t = {};
    (codes || []).forEach(c => { t[c] = { code: c, pj: 0, v: 0, d: 0, dp: 0, pts: 0, bp: 0, bc: 0 }; });
    Object.values(resultats).forEach(r => {
      [[r.visiteur, r.butsV, r.butsD], [r.domicile, r.butsD, r.butsV]].forEach(([c, pour, contre]) => {
        // Liste d'équipes donnée (une division, une conférence) : les autres sont ignorées.
        if(!c || (codes && !t[c])) return;
        const e = t[c] || (t[c] = { code: c, pj: 0, v: 0, d: 0, dp: 0, pts: 0, bp: 0, bc: 0 });
        e.pj++; e.bp += pour; e.bc += contre;
        if(pour > contre){ e.v++; e.pts += 2; }
        else if(r.fin){ e.dp++; e.pts += 1; }
        else e.d++;
      });
    });
    return Object.values(t).map(e => Object.assign(e, { diff: e.bp - e.bc }))
      .sort((a, b) => b.pts - a.pts || b.v - a.v || b.diff - a.diff || b.bp - a.bp || a.code.localeCompare(b.code));
  }

  // Stats d'équipe tirées des écrans de fin de match : totaux, puis moyennes et pourcentages.
  const nombre = v => { const n = parseFloat(String(v || '').replace(',', '.')); return isNaN(n) ? null : n; };
  const secondes = v => { const m = /^(\d+):(\d{2})$/.exec(String(v || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const fraction = v => { const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(v || '').trim()); return m ? [Number(m[1]), Number(m[2])] : null; };

  function statsEquipes(resultats, codes){
    const t = {};
    const vide = c => ({ code: c, pj: 0, bp: 0, bc: 0, tirs: 0, tirsContre: 0, mises: 0, attaque: 0, nbAttaque: 0,
      passes: 0, nbPasses: 0, mjPour: 0, mjContre: 0, penalites: 0, anButs: 0, anOcc: 0, dnButs: 0, dnOcc: 0,
      minAvantage: 0, inferiorite: 0 });
    (codes || []).forEach(c => { t[c] = vide(c); });
    Object.values(resultats).forEach(r => {
      [[r.visiteur, 0, r.butsV, r.butsD], [r.domicile, 1, r.butsD, r.butsV]].forEach(([c, i, pour, contre]) => {
        if(!c || (codes && !t[c])) return;
        const e = t[c] || (t[c] = vide(c));
        const s = k => (r.stats[k] || [])[i], adv = k => (r.stats[k] || [])[1 - i];
        e.pj++; e.bp += pour; e.bc += contre;
        e.tirs += nombre(s('tirs')) || 0; e.tirsContre += nombre(adv('tirs')) || 0;
        e.mises += nombre(s('mises')) || 0;
        const att = secondes(s('attaque')); if(att != null){ e.attaque += att; e.nbAttaque++; }
        const pas = nombre(s('passes')); if(pas != null){ e.passes += pas; e.nbPasses++; }
        e.mjPour += nombre(s('engagements')) || 0; e.mjContre += nombre(adv('engagements')) || 0;
        e.penalites += secondes(s('penalites')) || 0;
        const an = fraction(s('avantages')); if(an){ e.anButs += an[0]; e.anOcc += an[1]; }
        const dn = fraction(adv('avantages')); if(dn){ e.dnButs += dn[0]; e.dnOcc += dn[1]; }
        e.minAvantage += secondes(s('minAvantage')) || 0;
        e.inferiorite += nombre(s('inferiorite')) || 0;
      });
    });
    const parMatch = (v, e) => e.pj ? v / e.pj : null;
    return Object.values(t).map(e => ({
      code: e.code, pj: e.pj,
      bpMoy: parMatch(e.bp, e), bcMoy: parMatch(e.bc, e),
      tirsMoy: parMatch(e.tirs, e), tirsContreMoy: parMatch(e.tirsContre, e),
      misesMoy: parMatch(e.mises, e),
      attaqueMoy: e.nbAttaque ? e.attaque / e.nbAttaque : null,          // secondes
      passesMoy: e.nbPasses ? e.passes / e.nbPasses : null,               // %
      mjPct: e.mjPour + e.mjContre ? 100 * e.mjPour / (e.mjPour + e.mjContre) : null,
      penalitesMoy: e.pj ? e.penalites / 60 / e.pj : null,                // minutes
      anButs: e.anButs, anOcc: e.anOcc, anPct: e.anOcc ? 100 * e.anButs / e.anOcc : null,
      dnPct: e.dnOcc ? 100 * (1 - e.dnButs / e.dnOcc) : null,
      minAvantage: e.minAvantage,                                          // secondes (total)
      inferiorite: e.inferiorite,
    }));
  }

  window.LNHQ_RESULTATS = Object.freeze({ STATS, FINS, CONFERENCES, chargerResultats, classement, statsEquipes });
})();
