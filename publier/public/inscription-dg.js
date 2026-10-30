/* LNHQ — demande d'accès DG (dg.lnhq.ca/inscription.html), connecté par Discord : aucun
   courriel. La demande ajoute une ligne « À approuver » dans l'onglet ACCES ; un admin
   décide sur admin.html. */
(function(){
  const $ = id => document.getElementById(id);
  const ERREURS = {
    equipe: 'Choisis ton équipe dans la liste.',
    equipe_prise: 'Cette équipe a déjà un DG inscrit (ou une demande en attente).',
    plein: "Trop de demandes en attente pour l'instant. Réessaie plus tard ou contacte un dirigeant.",
    acces: 'Ta session n’est plus valide. Recharge la page.',
  };

  function etat(texte, ok){
    const e = $('etat');
    e.textContent = texte;
    e.className = 'adm-etat ' + (ok ? 'is-ok' : 'is-erreur');
    e.hidden = false;
  }

  function montrerStatut(statut, equipe){
    $('formulaire').hidden = true;
    if(statut === 'attente') etat(`⏳ Ta demande${equipe ? ' pour ' + equipe : ''} est reçue et attend l'approbation d'un dirigeant.`, true);
    else if(statut === 'refuse') etat("Ta demande n'a pas été approuvée. Contacte un dirigeant de la ligue.", false);
  }

  async function json(chemin, options){
    try{ return await (await fetch(chemin, { cache: 'no-store', ...options })).json(); }
    catch(e){ return { ok: false, erreur: 'reseau' }; }
  }

  async function chargerEquipes(){
    const r = await json('/api/equipes');
    const choix = $('equipe');
    if(!r.ok){
      choix.replaceChildren(new Option('Équipes indisponibles pour le moment', ''));
      $('envoyer').disabled = true;
      return;
    }
    const libres = r.equipes.filter(e => !e.approuves && !e.attente);
    choix.replaceChildren(new Option(libres.length ? 'Choisis ton équipe…' : 'Toutes les équipes sont inscrites', ''),
      ...libres.map(e => new Option(e.equipe, e.equipe)));
    choix.disabled = !libres.length;
    $('envoyer').disabled = !libres.length;
  }

  async function demarrer(){
    const moi = await json('/api/moi');
    if(moi.ok){
      $('qui').textContent = moi.nomDiscord ? `${moi.equipe} · ${moi.nomDiscord}` : moi.equipe;
      etat(`Tu as déjà accès (${moi.equipe}).`, true);
      $('aller').hidden = false;
      return;
    }
    if(moi.erreur !== 'inconnu'){
      $('qui').textContent = '';
      etat(ERREURS[moi.erreur] || 'Vérification impossible pour le moment. Réessaie plus tard.', false);
      return;
    }
    $('qui').textContent = 'Inscription';
    const s = await json('/api/inscription');
    if(s.ok && (s.statut === 'attente' || s.statut === 'refuse')){ montrerStatut(s.statut, s.equipe); return; }
    $('formulaire').hidden = false;
    $('noteLier').hidden = false;
    chargerEquipes();
  }

  $('formulaire').addEventListener('submit', async e => {
    e.preventDefault();
    const equipe = $('equipe').value;
    if(!equipe){ etat(ERREURS.equipe, false); return; }
    $('envoyer').disabled = true;
    const r = await json('/api/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipe }) });
    $('envoyer').disabled = false;
    if(!r.ok){ etat(ERREURS[r.erreur] || "L'envoi a échoué. Réessaie dans un instant.", false); chargerEquipes(); return; }
    if(r.statut === 'approuve'){ location.href = '/'; return; }
    $('noteLier').hidden = true;
    montrerStatut(r.statut, r.equipe);
  });

  demarrer();
})();
