/* =========================================================================
   LNHQ — alignement d'une équipe (4 trios, 3 paires de défense, 2 gardiens).
   Partagé par la page Équipe (lnhq.ca, onglet Alignement) et la page de
   modification de publier.lnhq.ca.
   - Joueurs : PLAYERSDATABASE (Z = équipe ; choix de repêchage exclus ; les
     espoirs, colonne AB, restent hors de l'alignement automatique).
   - Alignement choisi par le DG : onglet ALIGNEMENTS (une ligne par équipe, une
     colonne par place, le nom « Nom, Prénom » de la colonne B), écrit par le script.
   - Places vides ou joueur parti (échange) : complétées automatiquement par
     position puis overall.
   ========================================================================= */
(function(){
  const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';

  // Ordre des places = ordre des colonnes de l'onglet ALIGNEMENTS (après « Équipe »).
  const PLACES = [];
  for(let l = 1; l <= 4; l++) [['G', 'AG'], ['C', 'C'], ['D', 'AD']].forEach(([c, label]) => PLACES.push({ id: 'A' + l + c, groupe: 'A', ligne: l, label }));
  for(let l = 1; l <= 3; l++) [['G', 'DG'], ['D', 'DD']].forEach(([c, label]) => PLACES.push({ id: 'D' + l + c, groupe: 'D', ligne: l, label }));
  PLACES.push({ id: 'G1', groupe: 'G', ligne: 1, label: 'Partant' }, { id: 'G2', groupe: 'G', ligne: 1, label: 'Réserve' });

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

  const FORMATS = { C: 'C', L: 'AG', R: 'AD', D: 'D', G: 'G' };

  // Numéros LNH (onglet IDS_LNH, rempli par remplirIdsLnh du script) → photo officielle.
  async function chargerIds(){
    try{
      const lignes = await gviz('sheet=IDS_LNH&headers=1');
      if(lignes.entetes[0] !== 'Joueur' || lignes.entetes[1] !== 'NHL ID') return new Map();
      return new Map(lignes.filter(l => l[0] && /^\d{6,8}$/.test(l[1])).map(l => [l[0], l[1]]));
    }catch(e){ return new Map(); }
  }

  async function chargerJoueurs(code){
    const q = encodeURIComponent(`select A, B, C, H, J, K, L, AB, G where Z = '${code}' and H <> 'CHOIX'`);
    const [lignes, ids] = await Promise.all([gviz('sheet=PLAYERSDATABASE&headers=1&tq=' + q), chargerIds()]);
    return lignes.filter(l => l[1]).map(l => {
      const v = l[1].indexOf(',');
      const famille = v > 0 ? l[1].slice(0, v).trim() : l[1];
      const prenom = v > 0 ? l[1].slice(v + 1).trim() : '';
      return {
        id: l[1], prenom, famille, nom: l[0] || (prenom + ' ' + famille).trim(),
        ov: Number(l[2]) || 0, po: (l[3] || '').toUpperCase(), sh: (l[4] || '').toUpperCase(),
        ht: l[5] || '', wt: l[6] || '', espoir: /^(true|vrai|x|oui)$/i.test(l[7] || ''), pays: (l[8] || '').toUpperCase(),
        idLnh: ids.get(l[1]) || '',
      };
    });
  }

  // { places: { A1C: 'Suzuki, Nick', … }, modifie, par } ou null si l'équipe n'a rien enregistré.
  async function chargerSauvegarde(code){
    let lignes;
    try{ lignes = await gviz('sheet=ALIGNEMENTS&headers=1'); }catch(e){ return null; }
    // Onglet absent : l'API renvoie en silence le 1er onglet ; on vérifie l'en-tête.
    if(lignes.entetes[0] !== 'Équipe' || lignes.entetes[1] !== PLACES[0].id) return null;
    const l = lignes.find(x => (x[0] || '').toUpperCase() === code);
    if(!l) return null;
    const places = {};
    PLACES.forEach((p, i) => { if(l[i + 1]) places[p.id] = l[i + 1]; });
    return { places, modifie: l[PLACES.length + 1] || '', par: l[PLACES.length + 2] || '' };
  }

  // Place → joueur. Les places enregistrées dont le joueur est encore dans l'équipe sont
  // gardées ; les autres sont complétées du 1er trio au 4e : centre par les centres,
  // ailiers par leur côté, sinon le meilleur attaquant restant ; défense et gardiens
  // par overall seulement.
  function composer(joueurs, sauvegarde){
    const parId = new Map(joueurs.map(j => [j.id, j]));
    const places = {};
    const pris = new Set();
    if(sauvegarde) PLACES.forEach(p => {
      const j = parId.get(sauvegarde.places[p.id]);
      if(j && !pris.has(j.id)){ places[p.id] = j; pris.add(j.id); }
    });
    const dispo = filtre => joueurs.filter(j => !j.espoir && !pris.has(j.id) && filtre(j)).sort((a, b) => b.ov - a.ov);
    const prendre = (p, ...filtres) => {
      if(places[p.id]) return;
      for(const f of filtres){
        const j = dispo(f)[0];
        if(j){ places[p.id] = j; pris.add(j.id); return; }
      }
      places[p.id] = null;
    };
    const attaquant = j => ['C', 'L', 'R'].includes(j.po);
    for(let l = 1; l <= 4; l++){
      prendre({ id: 'A' + l + 'C' }, j => j.po === 'C', attaquant);
      prendre({ id: 'A' + l + 'G' }, j => j.po === 'L', attaquant);
      prendre({ id: 'A' + l + 'D' }, j => j.po === 'R', attaquant);
    }
    PLACES.filter(p => p.groupe === 'D').forEach(p => prendre(p, j => j.po === 'D'));
    PLACES.filter(p => p.groupe === 'G').forEach(p => prendre(p, j => j.po === 'G'));
    const ordrePo = { C: 0, L: 1, R: 2, D: 3, G: 4 };
    const reservistes = joueurs.filter(j => !pris.has(j.id))
      .sort((a, b) => (a.espoir - b.espoir) || ((ordrePo[a.po] ?? 9) - (ordrePo[b.po] ?? 9)) || (b.ov - a.ov));
    return { places, reservistes };
  }

  function el(tag, cls, text){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    return e;
  }

  // Drapeau (colonne CNT, code à 3 lettres → flagcdn.com, comme la page Salaires).
  const PAYS_ISO2 = {
    can:'ca', usa:'us', swe:'se', fin:'fi', rus:'ru', cze:'cz', svk:'sk', ger:'de', sui:'ch', fra:'fr', den:'dk',
    nor:'no', lat:'lv', blr:'by', kaz:'kz', aut:'at', ita:'it', svn:'si', hun:'hu', pol:'pl', jpn:'jp', kor:'kr',
    chn:'cn', gbr:'gb', ned:'nl', ukr:'ua', est:'ee', ltu:'lt', rou:'ro', cro:'hr', srb:'rs', bul:'bg', esp:'es',
    aus:'au', nzl:'nz', rsa:'za', mex:'mx', bra:'br', isl:'is', irl:'ie', bel:'be', por:'pt', isr:'il', geo:'ge', uzb:'uz',
  };
  function drapeau(pays){
    const code = String(pays || '').toLowerCase();
    const iso2 = code.length === 2 ? code : PAYS_ISO2[code];
    if(!iso2) return null;
    const img = el('img', 'al-drapeau');
    img.src = `https://flagcdn.com/24x18/${iso2}.png`;
    img.alt = pays;
    img.title = pays;
    img.width = 18; img.height = 13;
    img.onerror = () => img.remove();
    return img;
  }

  // Côté du tir : un bâton dont la lame pointe à gauche (L) ou à droite (R).
  function baton(sh){
    if(sh !== 'L' && sh !== 'R') return null;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'al-baton' + (sh === 'R' ? ' is-droit' : ''));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', sh === 'L' ? 'Tir à gauche' : 'Tir à droite');
    const titre = document.createElementNS(ns, 'title');
    titre.textContent = sh === 'L' ? 'Tir à gauche (L)' : 'Tir à droite (R)';
    // Manche en diagonale (avec la poignée), lame large vers la gauche en bas
    // (retournée pour un droitier, voir .al-baton.is-droit).
    const manche = document.createElementNS(ns, 'path');
    manche.setAttribute('d', 'M18.2 0.8 L21.4 2.2 L13.4 17.6 L10.2 16.4 Z');
    const poignee = document.createElementNS(ns, 'path');
    poignee.setAttribute('d', 'M18.2 0.8 L21.4 2.2 L20.2 4.6 L17 3.2 Z');
    poignee.setAttribute('opacity', '0.55');
    const lame = document.createElementNS(ns, 'path');
    lame.setAttribute('d', 'M10.2 16.4 L13.4 17.6 Q12.6 21.6 9.4 22.4 L1.8 23.4 Q0.4 23.5 0.5 22.2 L0.7 20.6 Q0.9 19.4 2.1 19.3 L8.4 18.6 Q9.6 18.4 10.2 16.4 Z');
    [manche, lame].forEach(p => p.setAttribute('fill', 'currentColor'));
    poignee.setAttribute('fill', '#000');
    svg.append(titre, manche, lame, poignee);
    return svg;
  }

  // Carte d'un joueur (ou d'une place vide) : overall, place, prénom et nom, drapeau, tir, grandeur, poids.
  function carte(joueur, etiquette){
    const c = el('div', 'al-carte' + (joueur ? '' : ' is-vide') + (joueur && joueur.espoir ? ' is-espoir' : ''));
    const haut = el('div', 'al-haut');
    haut.append(el('span', 'al-ov', joueur ? String(joueur.ov || '–') : ''), el('span', 'al-place', etiquette || ''));
    c.append(haut);
    if(!joueur){
      c.append(el('div', 'al-vide', 'Place libre'));
      return c;
    }
    // Photo officielle LNH (si le numéro est connu), à droite, derrière le nom.
    if(joueur.idLnh){
      const photo = el('img', 'al-photo');
      photo.src = `https://assets.nhle.com/mugs/nhl/latest/${joueur.idLnh}.png`;
      photo.alt = '';
      photo.loading = 'lazy';
      photo.onerror = () => photo.remove();
      c.append(photo);
      c.classList.add('a-photo');
    }
    const nom = el('div', 'al-nom');
    nom.append(el('span', 'al-prenom', joueur.prenom), el('span', 'al-famille', joueur.famille));
    const infos = el('div', 'al-infos');
    const icones = el('span', 'al-icones');
    icones.append(...[drapeau(joueur.pays), baton(joueur.sh)].filter(Boolean));
    if(icones.children.length) infos.append(icones);
    infos.append(...[joueur.ht, joueur.wt && joueur.wt + ' lb'].filter(Boolean).map(t => el('span', null, t)));
    c.append(nom, infos);
    if(joueur.espoir) c.append(el('span', 'al-badge', 'Espoir'));
    c.title = `${joueur.nom} · ${joueur.po}${joueur.ov ? ' · ' + joueur.ov + ' OV' : ''}`;
    return c;
  }

  /* Rendu complet : attaque (4 trios) | défense (3 paires) + gardiens ; réservistes dessous.
     options.surCarte(placeId | 'R:' + idJoueur, element) : appelé pour chaque carte (pour
     la rendre cliquable sur la page de modification). */
  function rendre(conteneur, compo, options = {}){
    const brancher = (cle, carteEl) => { carteEl.dataset.cle = cle; if(options.surCarte) options.surCarte(cle, carteEl); return carteEl; };
    const bloc = (titre, cls) => { const b = el('section', 'al-bloc ' + cls); b.append(el('h3', 'al-bloc-titre', titre)); return b; };
    const rangee = (etiquette, places) => {
      const r = el('div', 'al-rangee');
      r.append(el('div', 'al-rangee-nom', etiquette));
      const cartes = el('div', 'al-cartes al-n' + places.length);
      places.forEach(p => cartes.append(brancher(p.id, carte(compo.places[p.id], p.label))));
      r.append(cartes);
      return r;
    };
    const att = bloc('Attaque', 'al-attaque');
    for(let l = 1; l <= 4; l++) att.append(rangee('Trio ' + l, PLACES.filter(p => p.groupe === 'A' && p.ligne === l)));
    const def = bloc('Défense', 'al-defense');
    for(let l = 1; l <= 3; l++) def.append(rangee('Paire ' + l, PLACES.filter(p => p.groupe === 'D' && p.ligne === l)));
    def.append(el('h3', 'al-bloc-titre al-sous-titre', 'Gardiens'), rangee('Devant le filet', PLACES.filter(p => p.groupe === 'G')));
    const grille = el('div', 'al-grille');
    grille.append(att, def);
    const res = bloc(`Réservistes (${compo.reservistes.length})`, 'al-reservistes');
    const cartes = el('div', 'al-cartes al-res');
    if(compo.reservistes.length) compo.reservistes.forEach(j => cartes.append(brancher('R:' + j.id, carte(j, j.po === 'L' ? 'AG' : j.po === 'R' ? 'AD' : j.po))));
    else cartes.append(el('p', 'al-aucun', 'Aucun réserviste : tout le monde est dans l’alignement.'));
    res.append(cartes);
    conteneur.replaceChildren(grille, res);
  }

  window.LNHQ_ALIGNEMENT = Object.freeze({ PLACES, chargerJoueurs, chargerSauvegarde, composer, carte, rendre });
})();
