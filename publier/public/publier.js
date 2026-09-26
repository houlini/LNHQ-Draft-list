/* LNHQ — éditeur de publication (publier.lnhq.ca). L'accès est déjà filtré par
   Cloudflare Access ; /api/moi indique l'équipe et le droit de publier des annonces. */
(function(){
  const $ = id => document.getElementById(id);
  const MAX_PHOTOS = 5;
  const COTE_MAX = 1600;
  const QUALITE_JPEG = 0.85;
  const PAGES = { NOUVELLES: 'https://lnhq.ca/nouvelles-test.html', ANNONCES: 'https://lnhq.ca/annonces.html' };
  const ERREURS = {
    acces: "Accès refusé. Recharge la page pour te reconnecter.",
    session: "Ta session a peut-être expiré. Recharge la page pour te reconnecter, ton texte sera perdu : copie-le d'abord.",
    inconnu: "Ton courriel n'est pas dans la liste d'accès de la ligue. Contacte le dirigeant de la ligue.",
    annonces: "Tu n'as pas le droit de publier une annonce.",
    vide: 'Le titre et le texte sont obligatoires.',
    photo: "Une des photos n'a pas pu être enregistrée.",
    taille: 'Les photos sont trop lourdes. Retires-en une et réessaie.',
  };

  const photos = []; // { blob, url }
  let editeur = null;
  let moi = null;

  async function api(chemin, options){
    try{
      const rep = await fetch(chemin, options);
      return await rep.json();
    }catch(err){
      // Access renvoie sa page de connexion (pas du JSON) quand la session a expiré.
      return { ok: false, erreur: 'session' };
    }
  }

  function afficher(texte, erreur, lien){
    const msg = $('message');
    msg.className = 'pub-message' + (erreur ? ' is-erreur' : ' is-succes');
    msg.textContent = texte;
    if(lien){
      const a = document.createElement('a');
      a.href = lien;
      a.textContent = 'Voir la publication';
      a.target = '_blank';
      a.rel = 'noopener';
      msg.append(' ', a);
    }
    msg.hidden = false;
  }

  function fluxChoisi(){
    const coche = document.querySelector('input[name="flux"]:checked');
    return coche ? coche.value : 'NOUVELLES';
  }

  function majQui(){
    const auNomDeLaLigue = moi.equipe === 'Ligue' || fluxChoisi() === 'ANNONCES';
    $('qui').textContent = auNomDeLaLigue ? 'Tu publies au nom de la ligue' : 'Tu publies pour ' + moi.equipe;
    $('lienFil').href = PAGES[fluxChoisi()];
  }

  /* ---------- Photos : réduites dans le navigateur avant l'envoi ---------- */
  async function reduire(fichier){
    const image = await createImageBitmap(fichier);
    const echelle = Math.min(1, COTE_MAX / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * echelle);
    canvas.height = Math.round(image.height * echelle);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', QUALITE_JPEG));
    if(!blob) throw new Error('conversion impossible');
    return { blob, url: URL.createObjectURL(blob) };
  }

  function enBase64(blob){
    return new Promise((res, rej) => {
      const lecteur = new FileReader();
      lecteur.onload = () => res(String(lecteur.result).split(',')[1]);
      lecteur.onerror = rej;
      lecteur.readAsDataURL(blob);
    });
  }

  function dessinerPhotos(){
    const vignettes = photos.map((p, i) => {
      const fig = document.createElement('figure');
      fig.className = 'pub-photo';
      const img = document.createElement('img');
      img.src = p.url;
      img.alt = '';
      const retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = 'pub-retirer';
      retirer.setAttribute('aria-label', 'Retirer cette photo');
      retirer.textContent = '×';
      retirer.addEventListener('click', () => {
        URL.revokeObjectURL(p.url);
        photos.splice(i, 1);
        dessinerPhotos();
      });
      fig.append(img, retirer);
      if(i === 0) fig.append(Object.assign(document.createElement('figcaption'), { textContent: 'Couverture' }));
      return fig;
    });
    $('apercus').replaceChildren(...vignettes);
    $('ajoutPhotos').hidden = photos.length >= MAX_PHOTOS;
  }

  $('fichiers').addEventListener('change', async e => {
    const choisis = [...e.target.files].slice(0, MAX_PHOTOS - photos.length);
    e.target.value = '';
    for(const fichier of choisis){
      try{
        photos.push(await reduire(fichier));
      }catch(err){
        afficher(`Impossible de lire « ${fichier.name} ». Essaie une photo JPEG ou PNG.`, true);
      }
    }
    dessinerPhotos();
  });

  /* ---------- Envoi ---------- */
  $('formulaire').addEventListener('submit', async e => {
    e.preventDefault();
    const titre = $('titre').value.trim();
    const texte = editeur.getMarkdown().trim();
    if(!titre || !texte){ afficher(ERREURS.vide, true); return; }

    const bouton = $('envoyer');
    bouton.disabled = true;
    bouton.textContent = 'Publication en cours…';
    $('message').hidden = true;

    const flux = fluxChoisi();
    const corps = {
      flux,
      titre,
      type: $('type').value,
      texte,
      photos: await Promise.all(photos.map(async p => ({ mime: 'image/jpeg', data: await enBase64(p.blob) }))),
    };
    const r = await api('/api/publier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    });

    if(r.ok){
      afficher(flux === 'ANNONCES' ? 'Annonce publiée sur le site et sur Discord.' : 'Nouvelle publiée sur le site et sur Discord.',
        false, /^https:\/\/lnhq\.ca\//.test(r.page || '') ? r.page : null);
      $('titre').value = '';
      editeur.setMarkdown('');
      photos.forEach(p => URL.revokeObjectURL(p.url));
      photos.length = 0;
      dessinerPhotos();
    }else{
      afficher(ERREURS[r.erreur] || 'La publication a échoué. Réessaie dans un instant.', true);
    }
    bouton.disabled = false;
    bouton.textContent = 'Publier';
  });

  /* ---------- Démarrage ---------- */
  async function demarrer(){
    moi = await api('/api/moi');
    if(!moi.ok){
      $('qui').textContent = '';
      $('refusTexte').textContent = ERREURS[moi.erreur] || 'Accès impossible pour le moment. Réessaie plus tard.';
      $('refus').hidden = false;
      return;
    }
    $('choixFlux').hidden = !moi.annonces;
    document.querySelectorAll('input[name="flux"]').forEach(r => r.addEventListener('change', majQui));
    majQui();

    editeur = new toastui.Editor({
      el: $('editeur'),
      height: '380px',
      initialEditType: 'wysiwyg',
      hideModeSwitch: true,
      language: 'fr-FR',
      usageStatistics: false,
      placeholder: 'Écris ta nouvelle ici…',
      // Pas de bouton image : les photos passent par la zone « Photos » (réduites et hébergées).
      toolbarItems: [['heading', 'bold', 'italic', 'strike'], ['hr', 'quote'], ['ul', 'ol'], ['table', 'link']],
    });
    $('formulaire').hidden = false;
  }

  demarrer();
})();
