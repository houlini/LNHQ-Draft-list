/* LNHQ — page d'administration (admins seulement : case « Annonces » de l'onglet ACCES).
   Regroupe les fonctions d'admin : compteurs « À faire », liens vers chaque outil (en mode
   admin : ?admin=1), demandes d'accès, et progression de la migration vers Discord. */
(function(){
  const $ = id => document.getElementById(id);
  const ERREURS = {
    acces: 'Ta session de connexion n’est plus valide. Recharge la page.',
    inconnu: "Ton compte n'est pas dans la liste d'accès de la ligue.",
    annonces: 'Cette page est réservée aux administrateurs de la ligue.',
  };
  let comptes = [];

  function el(tag, cls, text){
    const e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    return e;
  }
  function refuser(texte){
    $('qui').textContent = '';
    $('refusTexte').textContent = texte;
    $('refus').hidden = false;
  }

  function afficher(){
    // Comptes approuvés seulement dans le compte (les demandes en attente n'ont pas encore d'accès).
    const actifs = comptes.filter(c => c.statut === 'approuve');
    const lies = actifs.filter(c => c.lie).length;
    const pct = actifs.length ? Math.round(lies * 100 / actifs.length) : 0;
    $('pctLies').textContent = pct + ' %';
    $('txtLies').textContent = `${lies} compte${lies > 1 ? 's' : ''} lié${lies > 1 ? 's' : ''} sur ${actifs.length}`;
    $('barreRemplie').style.width = pct + '%';
    $('barre').setAttribute('aria-valuenow', pct);
    const equipes = new Set(actifs.filter(c => c.code).map(c => c.code));
    const equipesLiees = new Set(actifs.filter(c => c.code && c.lie).map(c => c.code));
    $('txtEquipes').textContent = `Équipes avec au moins un DG lié : ${equipesLiees.size} sur ${equipes.size}`;

    const tbody = $('lignes');
    tbody.replaceChildren();
    const liste = comptes
      .filter(c => !$('nonLies').checked || !c.lie)
      .sort((a, b) => (a.lie - b.lie) || (a.statut !== 'approuve') - (b.statut !== 'approuve') || a.equipe.localeCompare(b.equipe, 'fr'));
    for(const c of liste){
      const tr = el('tr', c.lie ? 'is-lie' : 'is-attente');
      const tdEq = el('td', 'is-texte');
      if(c.code){
        const img = el('img', 'adm-logo');
        img.src = `https://lnhq.ca/Logos/${c.code}.png`;
        img.alt = '';
        tdEq.append(img);
      }
      tdEq.append(c.equipe);
      if(c.admin) tdEq.append(' ', el('span', 'adm-puce', 'Admin'));
      if(c.statut !== 'approuve') tdEq.append(' ', el('span', 'adm-puce is-gris', c.statut === 'refuse' ? 'Refusé' : 'En attente'));
      const tdDiscord = el('td', 'is-texte');
      tdDiscord.append(el('span', 'adm-pastille ' + (c.lie ? 'is-ok' : 'is-non'), c.lie ? '✓' : '—'));
      tdDiscord.append(' ', c.lie ? (c.nomDiscord || 'Lié') : 'Pas encore lié');
      tr.append(tdEq, el('td', 'is-texte adm-compte', c.compte || '—'), tdDiscord, el('td', 'adm-date', c.lieLe || ''));
      tbody.append(tr);
    }
    if(!liste.length){
      const tr = el('tr');
      const td = el('td', 'adm-vide', 'Tous les comptes sont liés à Discord.');
      td.colSpan = 4;
      tr.append(td);
      tbody.append(tr);
    }
  }

  function afficherDemandes(){
    const attente = comptes.filter(c => c.statut === 'attente');
    const ul = $('listeDemandes');
    ul.replaceChildren();
    for(const c of attente){
      const li = el('li', 'adm-demande');
      const qui = el('div', 'adm-qui');
      if(c.code){
        const img = el('img', 'adm-logo');
        img.src = `https://lnhq.ca/Logos/${c.code}.png`;
        img.alt = '';
        qui.append(img);
      }
      qui.append(el('b', null, c.equipe), ' · ', c.nomDiscord || c.compte || 'Compte inconnu');
      if(c.demandeLe) qui.append(el('small', null, 'Demandé le ' + c.demandeLe));
      const actions = el('div', 'adm-actions');
      const oui = el('button', 'adm-petit is-oui', 'Approuver');
      const non = el('button', 'adm-petit', 'Refuser');
      oui.type = non.type = 'button';
      oui.addEventListener('click', () => decider(c, 'approuver', [oui, non]));
      non.addEventListener('click', () => {
        if(confirm(`Refuser la demande de ${c.nomDiscord || c.compte} pour ${c.equipe} ?`)) decider(c, 'refuser', [oui, non]);
      });
      actions.append(oui, non);
      li.append(qui, actions);
      ul.append(li);
    }
    if(!attente.length) ul.append(el('li', 'adm-note', 'Aucune demande en attente.'));
  }

  async function decider(c, decision, boutons){
    boutons.forEach(b => { b.disabled = true; });
    let r;
    try{
      r = await (await fetch('/api/admin/acces', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rangee: c.rangee, cle: c.cle, decision }) })).json();
    }catch(e){ r = { ok: false }; }
    const m = $('msgDemandes');
    m.hidden = false;
    if(!r.ok){
      boutons.forEach(b => { b.disabled = false; });
      m.className = 'adm-etat is-erreur';
      m.textContent = r.erreur === 'ligne' ? "Cette demande a changé dans l'onglet ACCES. Recharge la page." : 'La décision n’a pas pu être enregistrée. Réessaie.';
      return;
    }
    m.className = 'adm-etat is-ok';
    m.textContent = `${c.equipe} : demande ${decision === 'approuver' ? 'approuvée' : 'refusée'}.`;
    await charger();
  }

  function compteur(id, n){
    const a = $(id);
    a.querySelector('b').textContent = n == null ? '?' : String(n);
    a.classList.toggle('is-actif', n > 0);
  }

  // Compteurs « À faire » et dates des données : chargés à part, la page s'affiche sans eux.
  async function chargerResume(){
    let r;
    try{ r = await (await fetch('/api/admin/resume', { cache: 'no-store' })).json(); }catch(e){ r = { ok: false }; }
    if(!r.ok) return;
    compteur('cDemandes', r.demandes);
    compteur('cTransactions', r.transactions);
    compteur('cTirages', r.tirages);
    compteur('cDiscord', r.discord);
    if(r.importsStats && r.importsStats.length){
      $('dernierImport').textContent = 'Dernier : ' + r.importsStats.map(i => `${i.titre.replace('Import de ', '')} (${i.date})`).join(' · ');
    }
    if(r.ratings){
      const d = new Date(r.ratings);
      $('dateRatings').textContent = 'Mise à jour : ' + (isNaN(d) ? r.ratings : d.toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' }))
        + ' · envoi : pwsh publier/ratings-envoyer.ps1';
    }
  }

  async function charger(){
    let r;
    try{ r = await (await fetch('/api/admin/migration', { cache: 'no-store' })).json(); }catch(e){ r = { ok: false }; }
    if(!r.ok){ refuser(ERREURS[r.erreur] || 'Accès impossible pour le moment. Réessaie plus tard.'); return; }
    $('qui').textContent = 'Administration';
    comptes = r.comptes || [];
    $('afaire').hidden = false;
    $('outils').hidden = false;
    $('demandes').hidden = false;
    $('migration').hidden = false;
    afficherDemandes();
    afficher();
  }

  $('nonLies').addEventListener('change', afficher);
  charger().then(chargerResume);
})();
