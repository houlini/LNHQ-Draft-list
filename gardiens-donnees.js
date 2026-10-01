/* =========================================================================
   LNHQ — 2e gardien : données partagées (page Calendrier et page de déclaration
   de publier.lnhq.ca). Règle : chaque équipe fait jouer son 2e gardien au moins
   une fois par période de 2 semaines (périodes de l'onglet SCHEDULE).
   Déclarations : onglet GARDIENS (Équipe, Période, Match, Date, Adversaire,
   Déclaré le), écrit seulement par le script ; une ligne par équipe et période.
   ========================================================================= */
(function(){
  const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';
  const GID_CALENDRIER = '1528349633'; // onglet SCHEDULE

  // Nom complet (tel qu'écrit dans SCHEDULE) → code d'équipe.
  const CODES = {
    'anaheim ducks':'ANA', 'boston bruins':'BOS', 'buffalo sabres':'BUF', 'calgary flames':'CGY',
    'carolina hurricanes':'CAR', 'chicago blackhawks':'CHI', 'colorado avalanche':'COL', 'columbus blue jackets':'CBJ',
    'dallas stars':'DAL', 'detroit red wings':'DET', 'edmonton oilers':'EDM', 'florida panthers':'FLA',
    'los angeles kings':'LAK', 'minnesota wild':'MIN', 'montréal canadiens':'MTL', 'montreal canadiens':'MTL',
    'nashville predators':'NSH', 'new jersey devils':'NJD', 'new york islanders':'NYI', 'new york rangers':'NYR',
    'ottawa senators':'OTT', 'philadelphia flyers':'PHI', 'pittsburgh penguins':'PIT', 'san jose sharks':'SJS',
    'seattle kraken':'SEA', 'st. louis blues':'STL', 'st louis blues':'STL', 'tampa bay lightning':'TBL',
    'toronto maple leafs':'TOR', 'utah mammoth':'UTA', 'utah hockey club':'UTA', 'vancouver canucks':'VAN',
    'vegas golden knights':'VGK', 'washington capitals':'WSH', 'winnipeg jets':'WPG',
  };
  const code = nom => CODES[(nom || '').trim().toLowerCase()] || '';

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

  // Calendrier : chaque ligne d'en-tête (« Time » en colonne C) ouvre une nouvelle période.
  function lireCalendrier(lignes){
    const matchs = [];
    let periode = 0;
    lignes.forEach(r => {
      if((r[2] || '').toLowerCase() === 'time'){ periode++; return; }
      const date = (r[1] || '').slice(0, 10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !r[3]) return;
      matchs.push({ num: r[0], date, heure: r[2], visiteur: r[3], domicile: r[8],
        codeVisiteur: code(r[3]), codeDomicile: code(r[8]), periode: Math.max(1, periode) });
    });
    return matchs;
  }

  // Périodes : numéro, premier et dernier jour.
  function periodes(matchs){
    const par = new Map();
    matchs.forEach(m => {
      const p = par.get(m.periode) || { num: m.periode, debut: m.date, fin: m.date };
      if(m.date < p.debut) p.debut = m.date;
      if(m.date > p.fin) p.fin = m.date;
      par.set(m.periode, p);
    });
    return [...par.values()].sort((a, b) => a.num - b.num);
  }

  async function chargerCalendrier(){
    return lireCalendrier(await gviz('gid=' + GID_CALENDRIER + '&headers=0'));
  }

  // Déclarations : { 'TOR|3': { equipe, periode, match, date, adversaire } }.
  async function chargerDeclarations(){
    let lignes;
    try{ lignes = await gviz('sheet=GARDIENS&headers=1'); }catch(e){ return {}; }
    // Onglet absent : l'API renvoie en silence le 1er onglet (DRAFT) ; on vérifie l'en-tête.
    if(lignes.entetes[0] !== 'Équipe' || lignes.entetes[1] !== 'Période') return {};
    const decl = {};
    lignes.forEach(l => {
      const equipe = (l[0] || '').toUpperCase(), periode = Number(l[1]);
      if(!equipe || !periode || !l[2]) return;
      decl[equipe + '|' + periode] = { equipe, periode, match: l[2], date: l[3], adversaire: (l[4] || '').toUpperCase() };
    });
    return decl;
  }

  function aujourdhui(){
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  window.LNHQ_GARDIENS = Object.freeze({ code, chargerCalendrier, chargerDeclarations, periodes, lireCalendrier, aujourdhui });
})();
