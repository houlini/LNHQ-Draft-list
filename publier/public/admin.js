/* LNHQ — page d'administration (admins seulement : case « Annonces » de l'onglet ACCES).
   Pour l'instant : progression de la migration des comptes vers la connexion Discord. */
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

  async function demarrer(){
    let r;
    try{ r = await (await fetch('/api/admin/migration', { cache: 'no-store' })).json(); }catch(e){ r = { ok: false }; }
    if(!r.ok){ refuser(ERREURS[r.erreur] || 'Accès impossible pour le moment. Réessaie plus tard.'); return; }
    $('qui').textContent = 'Administration';
    comptes = r.comptes || [];
    $('migration').hidden = false;
    afficher();
  }

  $('nonLies').addEventListener('change', afficher);
  demarrer();
})();
