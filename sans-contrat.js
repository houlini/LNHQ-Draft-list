/* =========================================================================
   LNHQ — joueurs « Sans contrat LNH » : leur contrat LNHQ est fictif (le joueur
   n'a pas de contrat dans la vraie LNH). Repérés par un « x » dans la colonne X
   (CONT. LNHQ) de PLAYERSDATABASE. Partout où ils apparaissent, le salaire (ou le
   nom, s'il n'y a pas de salaire) est en rouge avec un « * » (classe .sans-contrat
   de site.css) et l'explication au survol.
   ========================================================================= */
(function(){
  const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';
  const TEXTE = 'Sans contrat LNH (contrat fictif LNHQ)';

  // « Edvinsson, Simon » et « Simon Edvinsson » → même clé, sans accents ni casse.
  function cle(nom){
    let n = String(nom || '').trim();
    const v = n.indexOf(',');
    if(v > 0) n = n.slice(v + 1).trim() + ' ' + n.slice(0, v).trim();
    return n.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  let promesse = null;
  // { cles: Set, parEquipe: { MTL: ['Edvinsson, Simon'] } } ; liste vide si la lecture échoue.
  function charger(){
    if(promesse) return promesse;
    promesse = (async () => {
      const q = encodeURIComponent("select B, Z where X = 'x'");
      try{
        const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=1&sheet=PLAYERSDATABASE&tq=${q}&t=${Date.now()}`, { cache: 'no-store' });
        const m = (await res.text()).match(/setResponse\(([\s\S]*)\);\s*$/);
        const json = JSON.parse(m[1]);
        if(json.status === 'error') throw new Error('gviz');
        const cles = new Set(), parEquipe = {};
        json.table.rows.forEach(r => {
          const c = r.c || [];
          const nom = c[0] && c[0].v != null ? String(c[0].v).trim() : '';
          const equipe = c[1] && c[1].v != null ? String(c[1].v).trim().toUpperCase() : '';
          if(!nom) return;
          cles.add(cle(nom));
          if(equipe) (parEquipe[equipe] = parEquipe[equipe] || []).push(nom);
        });
        return { cles, parEquipe };
      }catch(e){
        return { cles: new Set(), parEquipe: {} };
      }
    })();
    return promesse;
  }

  function marquer(el, texte){
    el.classList.add('sans-contrat');
    el.title = texte || TEXTE;
  }

  // Note sous une liste : « * Sans contrat LNH (contrat fictif LNHQ) : Edvinsson, Simon. »
  function note(noms){
    const p = document.createElement('p');
    p.className = 'sans-contrat-note';
    const etoile = document.createElement('span');
    etoile.className = 'sans-contrat';
    p.append(etoile, ' ' + TEXTE + (noms && noms.length ? ' : ' + noms.join(' · ') : '') + '.');
    return p;
  }

  window.LNHQ_SANS_CONTRAT = Object.freeze({ TEXTE, cle, charger, marquer, note });
})();
