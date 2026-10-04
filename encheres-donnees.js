/* =========================================================================
   LNHQ — données des enchères des agents libres, lues dans le classeur public :
   ENCHERES, MISES, JETONS, et les agents libres de PLAYERSDATABASE (colonne Z
   « LNHQ TM » = UFA). Utilisé par lnhq.ca/encheres.html et par la page de mise
   de publier.lnhq.ca. Les règles réelles sont vérifiées par le script (sous verrou) ;
   ce module sert seulement à afficher.
   ========================================================================= */
(function(){
  const SHEET_ID = '1WEyoL9bgrGSQmX2HmEWxW7cCRp1hw9fQAQti6y9eD4A';
  // Mise maximale 1000 : dès 981 la mise suivante est 1000 ; à 1000, les autres équipes
  // peuvent miser 1000 aussi (égalité → tirage au sort). Ouverture : mardi 6 octobre 2026,
  // 19 h heure de l'Est (même date que OUVERTURE_ENCHERES dans le script).
  const REGLES = { miseMinimale: 50, surenchere: 20, miseMaximale: 1000, parSaison: 1000, heuresLancement: 24, heuresRelance: 12,
    ouverture: new Date('2026-10-06T23:00:00Z') };
  const ouvert = () => Date.now() >= REGLES.ouverture.getTime();
  // Mise minimale pour devancer (ou égaler, à 1000) l'équipe en tête.
  const minimum = e => Math.min(e.mise + REGLES.surenchere, REGLES.miseMaximale);

  async function gviz(params){
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=1&${params}&t=${Date.now()}`);
    if(!res.ok) throw new Error('http_' + res.status);
    const m = (await res.text()).match(/setResponse\(([\s\S]*)\);\s*$/);
    if(!m) throw new Error('format_inattendu');
    const json = JSON.parse(m[1]);
    if(json.status === 'error') throw new Error('erreur_gviz');
    return json.table;
  }

  // Valeur affichée (f) si elle existe, sinon la valeur brute, toujours en texte.
  function lignes(table){
    return table.rows.map(r => (r.c || []).map(c => c ? String(c.f != null ? c.f : (c.v != null ? c.v : '')).trim() : ''));
  }

  function verifier(table, premiere){
    if(((table.cols[0] || {}).label || '').trim() !== premiere) throw new Error('onglet_introuvable');
  }

  const nombre = v => Number(String(v).replace(/[^\d.-]/g, '')) || 0;

  async function charger(){
    const [tEncheres, tMises, tJetons] = await Promise.all([
      gviz('sheet=ENCHERES'), gviz('sheet=MISES'), gviz('sheet=JETONS'),
    ]);
    verifier(tEncheres, 'ID');
    verifier(tJetons, 'Équipe');

    const encheres = lignes(tEncheres).map(l => ({
      id: l[0], joueur: l[1], naissance: l[2], position: l[3], ov: l[4], equipe: l[5].toUpperCase(),
      mise: nombre(l[6]), nb: nombre(l[7]), debut: l[8], fin: l[9], statut: l[10], saison: l[11],
      egalite: (l[13] || '').split(',').map(c => c.trim().toUpperCase()).filter(Boolean),
    })).filter(e => e.id);

    const mises = (((tMises.cols[0] || {}).label || '') === 'Date' ? lignes(tMises) : []).map(l => ({
      date: l[0], id: l[1], joueur: l[2], equipe: l[3].toUpperCase(), mise: nombre(l[4]),
    })).filter(m => m.id);

    let saison = '';
    const equipes = lignes(tJetons).filter(l => l[1]).map(l => {
      if(l[3]) saison = l[3];
      return { nom: l[0], code: l[1].toUpperCase(), depart: l[2] === '' ? REGLES.parSaison : nombre(l[2]) };
    });
    // Jetons disponibles = départ − enchères gagnées − enchères où l'équipe est en tête
    // ou à égalité à 1000 jusqu'au tirage (même saison).
    equipes.forEach(eq => {
      eq.depenses = 0; eq.engages = 0;
      encheres.filter(e => e.saison === saison).forEach(e => {
        if(e.statut === 'Terminée' && e.equipe === eq.code) eq.depenses += e.mise;
        else if((e.statut === 'En cours' || e.statut === 'Tirage') && (e.equipe === eq.code || e.egalite.includes(eq.code))) eq.engages += e.mise;
      });
      eq.disponibles = eq.depart - eq.depenses - eq.engages;
    });
    return { encheres, mises, equipes, saison };
  }

  // Agents libres : colonne Z (LNHQ TM) = UFA dans PLAYERSDATABASE.
  async function agentsLibres(){
    const q = encodeURIComponent("select B, C, D, E, H where Z = 'UFA' order by C desc");
    const table = await gviz('sheet=PLAYERSDATABASE&tq=' + q);
    return lignes(table).map(l => ({ nom: l[0], ov: l[1], age: l[2] ? String(Math.floor(nombre(l[2]))) : '', naissance: l[3], position: l[4] })).filter(j => j.nom);
  }

  // « 23 h 04 min », « 12 min 30 s », ou « Terminée ».
  function tempsRestant(fin){
    const ms = new Date(fin).getTime() - Date.now();
    if(!(ms > 0)) return 'Terminée';
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if(h >= 1) return `${h} h ${String(m).padStart(2, '0')} min`;
    return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  }

  /* Décompte avant l'ouverture : un bandeau placé au début de `conteneur`, mis à jour
     chaque seconde, qui disparaît à l'heure (puis appelle `quandOuvert`, s'il est donné).
     Rien n'est affiché si les enchères sont déjà ouvertes. Styles : .ench-decompte (site.css). */
  function decompte(conteneur, quandOuvert){
    if(ouvert() || !conteneur) return null;
    const quand = new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
    const bloc = document.createElement('section');
    bloc.className = 'ench-decompte';
    bloc.setAttribute('aria-live', 'off');
    const titre = document.createElement('p');
    titre.className = 'ench-decompte-titre';
    titre.textContent = 'Ouverture des enchères des agents libres';
    const cases = document.createElement('div');
    cases.className = 'ench-decompte-cases';
    const unites = [['j', 'jours'], ['h', 'heures'], ['m', 'minutes'], ['s', 'secondes']].map(([cle, nom]) => {
      const c = document.createElement('div');
      c.className = 'ench-decompte-case';
      const n = document.createElement('strong');
      const u = document.createElement('span');
      u.textContent = nom;
      c.append(n, u);
      cases.append(c);
      return [cle, n];
    });
    const date = document.createElement('p');
    date.className = 'ench-decompte-date';
    date.textContent = quand.format(REGLES.ouverture).replace(/^./, c => c.toUpperCase()) + ' (heure de l’Est)';
    bloc.append(titre, cases, date);
    conteneur.prepend(bloc);
    const maj = () => {
      const ms = REGLES.ouverture.getTime() - Date.now();
      if(ms <= 0){
        clearInterval(minuterie);
        bloc.remove();
        if(quandOuvert) quandOuvert();
        return;
      }
      const s = Math.floor(ms / 1000);
      const valeurs = { j: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
      unites.forEach(([cle, n]) => { n.textContent = String(valeurs[cle]).padStart(2, '0'); });
    };
    const minuterie = setInterval(maj, 1000);
    maj();
    return bloc;
  }

  window.LNHQ_ENCHERES = Object.freeze({ REGLES, ouvert, minimum, charger, agentsLibres, tempsRestant, decompte });
})();
