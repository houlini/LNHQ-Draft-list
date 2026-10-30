/* LNHQ — lien du compte Discord. Sur publier.lnhq.ca (courriel vérifié par Access), le
   bouton envoie vers la connexion Discord de dg.lnhq.ca, qui remplit l'ID Discord de la
   ligne du DG dans l'onglet ACCES. Sur dg.lnhq.ca, la page confirme le lien. */
(function(){
  const $ = id => document.getElementById(id);
  const surDg = location.hostname === 'dg.lnhq.ca';

  function etat(texte, ok){
    const e = $('etat');
    e.textContent = texte;
    e.className = 'adm-etat ' + (ok ? 'is-ok' : 'is-erreur');
    e.hidden = false;
  }

  async function demarrer(){
    let moi;
    try{ moi = await (await fetch('/api/moi', { cache: 'no-store' })).json(); }catch(e){ moi = { ok: false }; }
    if(!moi.ok){
      $('qui').textContent = '';
      etat(moi.erreur !== 'inconnu' ? 'Accès impossible pour le moment. Recharge la page.'
        : surDg ? "Ce compte Discord n'est lié à aucun compte LNHQ. Lie-le d'abord depuis publier.lnhq.ca/lier-discord.html, ou contacte le commissaire."
        : "Ton courriel n'est pas dans la liste d'accès de la ligue. Contacte le commissaire.", false);
      return;
    }
    $('qui').textContent = moi.equipe;
    if(moi.discord){
      const nom = moi.nomDiscord ? ` (${moi.nomDiscord})` : '';
      etat(new URLSearchParams(location.search).has('lie')
        ? `C'est fait : ton compte Discord${nom} est lié. Utilise maintenant dg.lnhq.ca.`
        : `Ton compte est déjà lié à Discord${nom}.`, true);
      $('aller').hidden = false;
      if(surDg){ $('aller').href = '/'; $('aller').textContent = 'Continuer'; }
      return;
    }
    $('lier').hidden = false;
  }

  $('lier').addEventListener('click', async () => {
    const b = $('lier');
    b.disabled = true;
    let r;
    try{ r = await (await fetch('/api/discord/lier', { method: 'POST' })).json(); }catch(e){ r = { ok: false }; }
    if(r.ok && r.url){ location.href = r.url; return; }
    b.disabled = false;
    etat('Impossible de commencer le lien pour le moment. Réessaie.', false);
  });

  demarrer();
})();
