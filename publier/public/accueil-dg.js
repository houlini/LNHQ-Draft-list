/* LNHQ — accueil de l'espace des DG (dg.lnhq.ca) : liens vers chaque fonction, et la
   zone Administration pour les admins (case « Annonces » de l'onglet ACCES). */
(function(){
  const $ = id => document.getElementById(id);
  const surDg = location.hostname === 'dg.lnhq.ca';

  function refuser(texte, lien, libelle){
    $('qui').textContent = '';
    $('refusTexte').textContent = texte;
    if(lien){
      const a = document.createElement('a');
      a.href = lien;
      a.textContent = libelle;
      $('refusTexte').append(' ', a);
    }
    $('refus').hidden = false;
  }

  async function demarrer(){
    $('deconnexion').hidden = !surDg;
    let moi;
    try{ moi = await (await fetch('/api/moi', { cache: 'no-store' })).json(); }catch(e){ moi = { ok: false }; }
    if(!moi.ok){
      if(moi.erreur === 'inconnu' && surDg){
        // Connecté par Discord, mais pas encore membre : demande d'accès (ou lien d'un ancien compte).
        location.replace('inscription.html');
        return;
      }else if(moi.erreur === 'inconnu'){
        refuser("Ton courriel n'est pas dans la liste d'accès de la ligue.", 'https://lnhq.ca/inscription.html', "S'inscrire");
      }else if(moi.erreur === 'acces'){
        refuser('Ta session n’est plus valide.', '/', 'Se reconnecter');
      }else{
        refuser('Accès impossible pour le moment. Réessaie plus tard.');
      }
      return;
    }
    $('qui').textContent = moi.nomDiscord ? `${moi.equipe} · ${moi.nomDiscord}` : moi.equipe;
    $('titreEquipe').textContent = moi.equipe === 'Ligue' ? 'Espace DG' : `Espace DG · ${moi.equipe}`;
    $('zoneAdmin').hidden = !moi.annonces;
    $('espace').hidden = false;
    // Encore sur l'ancienne adresse : proposer le lien Discord s'il n'est pas fait.
    if(!surDg && !moi.discord){
      const a = document.createElement('a');
      a.className = 'adm-rappel';
      a.href = 'lier-discord.html';
      a.textContent = 'Lie ton compte Discord pour te connecter sur dg.lnhq.ca sans code par courriel →';
      $('espace').prepend(a);
    }
  }

  demarrer();
})();
