/* =========================================================================
   LNHQ — marché des échanges (joueurs disponibles et joueurs recherchés).
   Partagé par la Gazette du bureau du DG (lnhq.ca) et la page de mise à jour
   de dg.lnhq.ca (marche.html).
   - Onglet MARCHE (une ligne par équipe), écrit par le script (sauverMarche) :
     Équipe | Posture | Disponibles (JSON) | Recherchés (JSON) | Note | Modifié le | Par
   - Disponibles : [{ j: « Nom, Prénom » de PLAYERSDATABASE (ou un choix), n: note }]
   - Recherchés : [{ pos, role, style, tir, ovMin, ageMax, contrat, n }] (critères vides = peu importe)
   - Rumeurs : générées ici à partir du marché, des joueurs et du classement.
   ========================================================================= */
(function(){
  const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';
  const ENTETES = ['Équipe', 'Posture', 'Disponibles', 'Recherchés', 'Note', 'Modifié le', 'Par'];
  const MAX_DISPONIBLES = 12, MAX_RECHERCHES = 6, MAX_NOTE = 200;

  // Critères d'un joueur recherché : [valeur, libellé]. Mêmes valeurs dans le script (sauverMarche).
  const CRITERES = {
    posture: [['', 'Pas précisé'], ['acheteur', 'Acheteur'], ['vendeur', 'Vendeur'], ['neutre', 'À l’écoute']],
    pos: [['', 'Toute position'], ['A', 'Attaquant'], ['C', 'Centre'], ['AG', 'Ailier gauche'], ['AD', 'Ailier droit'],
      ['D', 'Défenseur'], ['DG', 'Défenseur gauche'], ['DD', 'Défenseur droit'], ['G', 'Gardien'], ['CHOIX', 'Choix de repêchage']],
    role: [['', 'Tout rôle'], ['vedette', 'Vedette'], ['top', 'Top-6 / top-4'], ['milieu', 'Milieu d’alignement'], ['profondeur', 'Profondeur'],
      ['espoir', 'Espoir'], ['partant', 'Gardien partant'], ['auxiliaire', 'Gardien auxiliaire']],
    style: [['', 'Tout style'], ['marqueur', 'Marqueur'], ['fabricant', 'Fabricant de jeu'], ['puissance', 'Attaquant de puissance'],
      ['deux-sens', 'Joueur de deux sens'], ['defensif', 'Spécialiste défensif'], ['robuste', 'Joueur robuste'], ['mises', 'Spécialiste des mises au jeu'],
      ['def-offensif', 'Défenseur offensif'], ['def-defensif', 'Défenseur défensif']],
    tir: [['', 'Peu importe'], ['G', 'Gaucher'], ['D', 'Droitier']],
    contrat: [['', 'Peu importe'], ['expirant', 'Contrat expirant'], ['court', 'Court terme (2 ans ou moins)'], ['long', 'Long terme (3 ans et plus)'], ['bas', 'Bas salaire (moins de 2 M$)']],
  };
  const libelle = (cle, v) => ((CRITERES[cle] || []).find(x => x[0] === v) || [, ''])[1];

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
  const lireJson = (t, defaut) => { try{ const v = JSON.parse(t || ''); return Array.isArray(v) ? v : defaut; }catch(e){ return defaut; } };

  // Map code → { code, posture, disponibles, recherches, note, modifie, par } (vide si l'onglet n'existe pas encore).
  async function chargerMarche(){
    let lignes;
    try{ lignes = await gviz('sheet=MARCHE&headers=1'); }catch(e){ return new Map(); }
    // Onglet absent : l'API renvoie en silence le 1er onglet ; on vérifie l'en-tête.
    if(lignes.entetes[0] !== ENTETES[0] || lignes.entetes[2] !== ENTETES[2]) return new Map();
    return new Map(lignes.filter(l => /^[A-Z]{3}$/.test((l[0] || '').toUpperCase())).map(l => {
      const code = l[0].toUpperCase();
      return [code, { code, posture: l[1] || '', disponibles: lireJson(l[2], []).filter(d => d && d.j), recherches: lireJson(l[3], []).filter(Boolean),
        note: l[4] || '', modifie: l[5] || '', par: l[6] || '' }];
    }));
  }

  // Joueurs de la ligue (ou des équipes demandées) : nom, équipe, OV, âge, position, tir, contrat.
  // Colonnes de PLAYERSDATABASE : B nom, C OV, D âge, H position, J tir, M années de contrat, N salaire 2026-27, Z équipe, AB espoir.
  async function chargerJoueurs(codes){
    const filtre = codes && codes.length ? ' and (' + codes.map(c => `Z = '${c}'`).join(' or ') + ')' : " and Z <> ''";
    const q = encodeURIComponent(`select A, B, C, D, H, J, M, N, Z, AB where B <> ''${filtre}`);
    const lignes = await gviz('sheet=PLAYERSDATABASE&headers=1&tq=' + q);
    return lignes.map(l => {
      const po = String(l[4] || '').toUpperCase().split(/[\/,\s]+/).filter(Boolean)[0] || '';
      const choix = po === 'CHOIX';
      return {
        id: l[1], nom: l[0] || prenomNom(l[1]), ov: Number(l[2]) || 0, age: Math.floor(Number(String(l[3]).replace(',', '.')) || 0),
        po, choix, groupe: choix ? 'CHOIX' : po === 'G' ? 'G' : /^(LD|RD|D)$/.test(po) ? 'D' : 'A',
        tir: (l[5] || '').toUpperCase().slice(0, 1), ans: Number(l[6]) || 0, salaire: Number(String(l[7] || '').replace(/[^\d.]/g, '')) || 0,
        equipe: (l[8] || '').toUpperCase(), espoir: /^(true|vrai|x|oui)$/i.test(l[9] || ''),
      };
    });
  }
  const prenomNom = id => { const v = String(id).indexOf(','); return v > 0 ? (id.slice(v + 1).trim() + ' ' + id.slice(0, v).trim()) : String(id); };
  const ETIQUETTES_PO = { C: 'C', LW: 'AG', RW: 'AD', LD: 'DG', RD: 'DD', D: 'D', G: 'G', L: 'AG', R: 'AD', CHOIX: 'Choix' };
  const poCourt = p => ETIQUETTES_PO[p] || p;
  const millions = s => s ? (s / 1e6).toLocaleString('fr-CA', { maximumFractionDigits: 2 }) + ' M$' : '';

  // « Défenseur droitier, top-6 / top-4, 80+ OV, 28 ans max, contrat expirant » ;
  // enLigne : sans majuscule, pour une phrase (« cherche un défenseur droitier… »).
  function decrire(r, enLigne){
    const bas = s => s.charAt(0).toLowerCase() + s.slice(1);
    const gardien = r.pos === 'G' && (r.role === 'partant' || r.role === 'auxiliaire');
    const morceaux = [bas(gardien ? libelle('role', r.role) : r.pos ? libelle('pos', r.pos) : 'Joueur')
      + (r.tir && r.pos !== 'CHOIX' && r.pos !== 'G' ? (r.tir === 'D' ? ' droitier' : ' gaucher') : '')];
    if(r.role && !gardien) morceaux.push(bas(libelle('role', r.role)));
    if(r.style) morceaux.push(bas(libelle('style', r.style)));
    if(Number(r.ovMin)) morceaux.push(r.ovMin + '+ OV');
    if(Number(r.ageMax)) morceaux.push(r.ageMax + ' ans max');
    if(r.contrat) morceaux.push(bas(libelle('contrat', r.contrat)));
    const t = morceaux.join(', ');
    return enLigne ? t : t.charAt(0).toUpperCase() + t.slice(1);
  }

  // Le joueur répond-il à ce que l'équipe cherche ? (critères mesurables seulement : position, tir, OV, âge, contrat)
  function correspond(j, r){
    if(r.pos === 'CHOIX') return j.choix;
    if(j.choix) return false;
    if(r.pos === 'A' && j.groupe !== 'A') return false;
    if(r.pos === 'D' && j.groupe !== 'D') return false;
    if(r.pos === 'G' && j.groupe !== 'G') return false;
    if(r.pos === 'C' && j.po !== 'C') return false;
    if(r.pos === 'AG' && !/^(LW|L)$/.test(j.po)) return false;
    if(r.pos === 'AD' && !/^(RW|R)$/.test(j.po)) return false;
    if(r.pos === 'DG' && !(j.groupe === 'D' && (j.po === 'LD' || (j.po === 'D' && j.tir === 'L')))) return false;
    if(r.pos === 'DD' && !(j.groupe === 'D' && (j.po === 'RD' || (j.po === 'D' && j.tir === 'R')))) return false;
    if(r.tir && j.tir && j.tir !== (r.tir === 'D' ? 'R' : 'L')) return false;
    if(Number(r.ovMin) && j.ov < Number(r.ovMin)) return false;
    if(Number(r.ageMax) && j.age > Number(r.ageMax)) return false;
    if(r.contrat === 'expirant' && j.ans > 1) return false;
    if(r.contrat === 'court' && j.ans > 2) return false;
    if(r.contrat === 'long' && j.ans < 3) return false;
    if(r.contrat === 'bas' && j.salaire >= 2e6) return false;
    if(r.role === 'espoir' && !j.espoir && j.age > 23) return false;
    return true;
  }

  // Mariages possibles : un joueur disponible chez B répond à une recherche de A.
  function mariages(marche, joueursParId){
    const l = [];
    marche.forEach((a, codeA) => a.recherches.forEach(r => marche.forEach((b, codeB) => {
      if(codeA === codeB) return;
      b.disponibles.forEach(d => { const j = joueursParId.get(d.j); if(j && j.equipe === codeB && correspond(j, r)) l.push({ acheteur: codeA, vendeur: codeB, joueur: j, recherche: r }); });
    })));
    return l.sort((x, y) => y.joueur.ov - x.joueur.ov);
  }

  // Petit générateur pseudo-aléatoire stable pour la journée : les rumeurs changent chaque jour, pas à chaque visite.
  function graine(texte){ let h = 2166136261; for(const c of texte) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; }

  /* Rumeurs du jour : [{ titre, texte, equipes: [codes], joueur?, force }] triées par intérêt.
     ctx : { nom(code), jour: 'AAAA-MM-JJ', classement: [{ code, pts, pj, v, d }] }. */
  function rumeurs(marche, joueursParId, ctx){
    const alea = graine(ctx.jour || ''), pick = t => t[Math.floor(alea() * t.length)];
    const nom = ctx.nom || (c => c);
    const sources = ['Selon nos sources', 'D’après plusieurs dépisteurs', 'Selon un agent bien informé', 'Dans les coulisses de la ligue', 'Selon un DG rival', 'D’après nos informations'];
    const rang = new Map((ctx.classement || []).map((t, i) => [t.code, i + 1])), n = (ctx.classement || []).length;
    const desc = j => j.choix ? j.nom : `${j.nom} (${poCourt(j.po)}, ${j.ov} OV, ${j.age} ans${j.salaire ? ', ' + millions(j.salaire) : ''})`;
    const l = [];
    // 1. Mariages possibles : les plus belles rumeurs.
    const vus = new Set();
    mariages(marche, joueursParId).forEach(m => {
      const cle = m.joueur.id + '|' + m.acheteur;
      if(vus.has(cle)) return; vus.add(cle);
      l.push({ force: 90 + m.joueur.ov / 10 + alea() * 5, equipes: [m.acheteur, m.vendeur], joueur: m.joueur,
        titre: pick([`${m.joueur.nom} vers ${nom(m.acheteur)} ?`, `${nom(m.acheteur)} et ${nom(m.vendeur)} discutent`, `Le mariage parfait pour ${nom(m.acheteur)} ?`]),
        texte: `${pick(sources)}, ${nom(m.acheteur)} cherche un ${decrire(m.recherche, true)}. Or ${nom(m.vendeur)} a placé ${desc(m.joueur)} sur le marché. Les deux équipes se seraient parlé cette semaine.` });
    });
    // 2. Les joueurs disponibles, par ordre d'overall.
    marche.forEach((e, code) => e.disponibles.forEach(d => {
      const j = joueursParId.get(d.j);
      if(!j || j.equipe !== code) return;
      const r = rang.get(code), mauvaise = r && n && r > n * 0.66;
      l.push({ force: (j.choix ? 40 : j.ov - 20) + (mauvaise ? 8 : 0) + alea() * 6, equipes: [code], joueur: j,
        titre: j.choix ? pick([`${nom(code)} prêt à céder un choix`, `Un choix de ${nom(code)} sur la table`])
          : j.ov >= 85 ? pick([`Bombe : ${j.nom} sur le marché`, `${nom(code)} écouterait les offres pour ${j.nom}`]) : pick([`${j.nom} disponible`, `${nom(code)} magasine ${j.nom}`, `${j.nom} pourrait changer d’adresse`]),
        texte: `${pick(sources)}, ${nom(code)} serait prêt à se départir de ${desc(j)}.`
          + (mauvaise ? ` Au ${r}e rang de la ligue, l’équipe pourrait amorcer une reconstruction.` : '')
          + (j.ans === 1 && !j.choix ? ' Son contrat arrive à échéance à la fin de la saison.' : '')
          + (d.n ? ` « ${d.n} », confie-t-on dans l’entourage de l’équipe.` : '') });
    }));
    // 3. Ce que les équipes recherchent.
    marche.forEach((e, code) => e.recherches.forEach(r => {
      const rg = rang.get(code), aspirant = rg && rg <= 8;
      l.push({ force: 45 + (aspirant ? 10 : 0) + alea() * 8, equipes: [code],
        titre: pick([`${nom(code)} en quête d’un ${r.pos ? libelle('pos', r.pos).toLowerCase() : 'renfort'}`, `${nom(code)} magasine`, `${nom(code)} veut du renfort`]),
        texte: `${pick(sources)}, ${nom(code)} cherche activement un ${decrire(r, true)}.`
          + (aspirant ? ` L’équipe, ${rg}e au classement, voudrait mettre toutes les chances de son côté pour les séries.` : '')
          + (r.n ? ` On parle de : « ${r.n} ».` : '') });
    }));
    // 4. Posture générale de l'équipe (acheteur / vendeur).
    marche.forEach((e, code) => {
      if(e.posture === 'vendeur') l.push({ force: 50 + alea() * 6, equipes: [code], titre: `Vente de feu chez ${nom(code)} ?`, texte: `${pick(sources)}, ${nom(code)} serait officiellement en mode vendeur.` + (e.note ? ` « ${e.note} »` : '') });
      if(e.posture === 'acheteur') l.push({ force: 48 + alea() * 6, equipes: [code], titre: `${nom(code)} passe à l’attaque`, texte: `${pick(sources)}, ${nom(code)} serait parmi les acheteurs les plus actifs d’ici la date limite.` + (e.note ? ` « ${e.note} »` : '') });
    });
    return l.sort((a, b) => b.force - a.force);
  }

  window.LNHQ_MARCHE = Object.freeze({ ENTETES, CRITERES, MAX_DISPONIBLES, MAX_RECHERCHES, MAX_NOTE, libelle, chargerMarche, chargerJoueurs, decrire, correspond, mariages, rumeurs, prenomNom, poCourt, millions });
})();
