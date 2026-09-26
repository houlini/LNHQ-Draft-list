/* LNHQ — éditeur de publication (publier.lnhq.ca). L'accès est déjà filtré par
   Cloudflare Access ; /api/moi indique l'équipe et le droit de publier des annonces. */
(function(){
  const $ = id => document.getElementById(id);
  const COTE_MAX = 1600;
  const QUALITE_JPEG = 0.85;
  // Même palette que nouvelles.js, qui refuse toute autre couleur à l'affichage.
  const COULEURS = ['#E8590C', '#E03131', '#2F9E44', '#1C7ED6', '#E0A800', '#868E96'];
  const PAGES = { NOUVELLES: 'https://lnhq.ca/nouvelles-test.html', ANNONCES: 'https://lnhq.ca/annonces.html' };
  const ERREURS = {
    acces: "Accès refusé. Recharge la page pour te reconnecter.",
    session: "Ta session a peut-être expiré. Recharge la page pour te reconnecter, ton texte sera perdu : copie-le d'abord.",
    inconnu: "Ton courriel n'est pas dans la liste d'accès de la ligue. Contacte le dirigeant de la ligue.",
    annonces: "Tu n'as pas le droit de publier une annonce.",
    vide: 'Le titre et le texte sont obligatoires.',
    photo: "L'image n'a pas pu être enregistrée.",
    taille: "L'image est trop lourde.",
  };

  // Modèles proposés selon le type choisi (Markdown, comme le texte de l'éditeur).
  const MODELES = {
    'Transaction': [
      '## Détails de la transaction', '',
      '**Mon équipe reçoit :**', '', '- Joueur ou choix', '',
      "**L'autre équipe reçoit :**", '', '- Joueur ou choix', '',
      '## Pourquoi cet échange', '', '> Commentaire du DG',
    ].join('\n'),
    'Résultat': [
      '## Pointage', '',
      '| Équipe | 1re | 2e | 3e | Final |', '| --- | --- | --- | --- | --- |',
      '| Visiteur | 0 | 0 | 0 | 0 |', '| Domicile | 0 | 0 | 0 | 0 |', '',
      '## Faits saillants', '', '- ', '',
      '## Joueur du match', '', '**Nom** : buts, passes',
    ].join('\n'),
    'Blessure': [
      '## Joueur blessé', '',
      '**Joueur :** ', '', '**Blessure :** ', '', '**Absence prévue :** ', '',
      "## Impact sur l'équipe", '', 'Qui le remplace dans l’alignement ?',
    ].join('\n'),
    'Général': '',
  };
  let dernierModele = '';

  let couverture = null; // { blob, url }
  let envoisEnCours = 0;
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

  /* ---------- Images : réduites dans le navigateur avant l'envoi ---------- */
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
    return blob;
  }

  function enBase64(blob){
    return new Promise((res, rej) => {
      const lecteur = new FileReader();
      lecteur.onload = () => res(String(lecteur.result).split(',')[1]);
      lecteur.onerror = rej;
      lecteur.readAsDataURL(blob);
    });
  }

  function majBouton(){
    const bouton = $('envoyer');
    bouton.disabled = envoisEnCours > 0;
    bouton.textContent = envoisEnCours > 0 ? 'Envoi de l’image…' : 'Publier';
  }

  // Image placée dans le texte (bouton image, glisser-déposer ou coller) : enregistrée
  // tout de suite, puis insérée à l'endroit du curseur avec son adresse définitive.
  async function imageDansLeTexte(fichier, inserer){
    envoisEnCours++;
    majBouton();
    try{
      const blob = await reduire(fichier);
      const r = await api('/api/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mime: 'image/jpeg', data: await enBase64(blob) }),
      });
      if(r.ok && /^https:\/\/lh3\.googleusercontent\.com\//.test(r.url || '')) inserer(r.url, '');
      else afficher(ERREURS[r.erreur] || ERREURS.photo, true);
    }catch(err){
      afficher(`Impossible de lire « ${fichier.name || 'image'} ». Essaie une image JPEG ou PNG.`, true);
    }finally{
      envoisEnCours--;
      majBouton();
    }
  }

  function dessinerCouverture(){
    if(!couverture){
      $('apercus').replaceChildren();
      $('ajoutPhotos').hidden = false;
      return;
    }
    const fig = document.createElement('figure');
    fig.className = 'pub-photo';
    const img = document.createElement('img');
    img.src = couverture.url;
    img.alt = '';
    const retirer = document.createElement('button');
    retirer.type = 'button';
    retirer.className = 'pub-retirer';
    retirer.setAttribute('aria-label', "Retirer l'image de couverture");
    retirer.textContent = '×';
    retirer.addEventListener('click', () => {
      URL.revokeObjectURL(couverture.url);
      couverture = null;
      dessinerCouverture();
    });
    fig.append(img, retirer);
    $('apercus').replaceChildren(fig);
    $('ajoutPhotos').hidden = true;
  }

  $('fichiers').addEventListener('change', async e => {
    const fichier = e.target.files[0];
    e.target.value = '';
    if(!fichier) return;
    try{
      const blob = await reduire(fichier);
      couverture = { blob, url: URL.createObjectURL(blob) };
    }catch(err){
      afficher(`Impossible de lire « ${fichier.name} ». Essaie une image JPEG ou PNG.`, true);
    }
    dessinerCouverture();
  });

  /* ---------- Modèle selon le type ---------- */
  // Remplace le texte seulement s'il est vide ou encore identique au modèle précédent ;
  // sinon, on demande avant d'écraser ce que la personne a écrit.
  function appliquerModele(){
    const modele = MODELES[$('type').value] || '';
    const actuel = editeur.getMarkdown().trim();
    const intact = !actuel || actuel === dernierModele;
    if(!intact && !modele) return;
    if(!intact && !confirm('Remplacer ton texte par le modèle « ' + $('type').value + ' » ?')) return;
    editeur.setMarkdown(modele, false);
    dernierModele = editeur.getMarkdown().trim();
  }

  /* ---------- Placement d'une image : pleine largeur, à gauche ou à droite ---------- */
  // Le placement est noté à la fin de l'adresse (#gauche, #droite) : le site et
  // l'éditeur l'appliquent par CSS, et l'image se charge normalement.
  const PLACEMENTS = [
    { texte: 'Pleine largeur', suffixe: '' },
    { texte: 'À gauche', suffixe: '#gauche' },
    { texte: 'À droite', suffixe: '#droite' },
  ];
  const barrePlacement = document.createElement('div');
  barrePlacement.className = 'pub-placement';
  barrePlacement.hidden = true;
  document.body.append(barrePlacement);
  let imageChoisie = '';

  function echapperRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  PLACEMENTS.forEach(p => {
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.textContent = p.texte;
    bouton.addEventListener('click', () => {
      const motif = new RegExp('\\(' + echapperRegex(imageChoisie) + '(#(?:gauche|droite))?\\)', 'g');
      editeur.setMarkdown(editeur.getMarkdown().replace(motif, '(' + imageChoisie + p.suffixe + ')'), false);
      barrePlacement.hidden = true;
    });
    barrePlacement.append(bouton);
  });

  $('editeur').addEventListener('click', e => {
    const img = e.target.closest('.toastui-editor-ww-container img');
    if(!img){ barrePlacement.hidden = true; return; }
    imageChoisie = (img.getAttribute('src') || '').replace(/#.*$/, '');
    const r = img.getBoundingClientRect();
    barrePlacement.style.left = Math.max(8, r.left) + 'px';
    barrePlacement.style.top = Math.max(8, r.top - 44) + 'px';
    barrePlacement.hidden = false;
  });
  document.addEventListener('scroll', () => { barrePlacement.hidden = true; }, true);

  /* ---------- Menu « Taille » de la barre d'outils ---------- */
  function menuTaille(){
    const tailles = [
      { texte: 'Titre', niveau: 2, cls: 'pub-taille-titre' },
      { texte: 'Sous-titre', niveau: 3, cls: 'pub-taille-sous-titre' },
      { texte: 'Normal', niveau: 0, cls: 'pub-taille-normal' },
    ];
    const liste = document.createElement('ul');
    liste.className = 'pub-menu-taille';
    tailles.forEach(t => {
      const item = document.createElement('li');
      item.className = t.cls;
      item.textContent = t.texte;
      item.addEventListener('click', () => {
        editeur.exec('heading', { level: t.niveau });
        editeur.eventEmitter.emit('closePopup');
        editeur.focus();
      });
      liste.append(item);
    });
    return {
      name: 'taille',
      tooltip: 'Taille du texte',
      text: 'Taille',
      className: 'pub-bouton-taille toastui-editor-toolbar-icons',
      style: { backgroundImage: 'none', width: 'auto', padding: '0 8px', fontWeight: '700', fontSize: '13px' },
      popup: { body: liste, style: { width: 'auto' } },
    };
  }

  /* ---------- Envoi ---------- */
  $('formulaire').addEventListener('submit', async e => {
    e.preventDefault();
    if(envoisEnCours > 0) return;
    const titre = $('titre').value.trim();
    const texte = editeur.getMarkdown().trim();
    if(!titre || !texte){ afficher(ERREURS.vide, true); return; }

    const bouton = $('envoyer');
    bouton.disabled = true;
    bouton.textContent = 'Publication en cours…';
    $('message').hidden = true;

    const flux = fluxChoisi();
    const r = await api('/api/publier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flux,
        titre,
        type: $('type').value,
        texte,
        couverture: couverture ? { mime: 'image/jpeg', data: await enBase64(couverture.blob) } : null,
      }),
    });

    if(r.ok){
      const quoi = flux === 'ANNONCES' ? 'Annonce publiée' : 'Nouvelle publiée';
      afficher(r.discord === false
        ? quoi + " sur le site, mais Discord l'a refusée. Préviens le dirigeant de la ligue."
        : quoi + ' sur le site et sur Discord.',
        r.discord === false, /^https:\/\/lnhq\.ca\//.test(r.page || '') ? r.page : null);
      $('titre').value = '';
      editeur.setMarkdown('');
      dernierModele = '';
      $('type').value = 'Général';
      if(couverture) URL.revokeObjectURL(couverture.url);
      couverture = null;
      dessinerCouverture();
    }else{
      afficher(ERREURS[r.erreur] || 'La publication a échoué. Réessaie dans un instant.', true);
    }
    majBouton();
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

    // L'extension de couleur de Toast UI 3.1.0 s'enregistre par erreur sous le nom « uml ».
    const extensionCouleur = toastui.Editor.plugin.colorSyntax || toastui.Editor.plugin.uml;
    editeur = new toastui.Editor({
      el: $('editeur'),
      height: '420px',
      initialEditType: 'wysiwyg',
      hideModeSwitch: true,
      language: 'fr-FR',
      usageStatistics: false,
      placeholder: 'Écris ta nouvelle ici…',
      plugins: extensionCouleur ? [[extensionCouleur, { preset: COULEURS }]] : [],
      toolbarItems: [
        [menuTaille(), 'bold', 'italic', 'strike'],
        ['hr', 'quote'],
        ['ul', 'ol'],
        ['table', 'image', 'link'],
      ],
      hooks: { addImageBlobHook: imageDansLeTexte },
    });
    $('type').addEventListener('change', appliquerModele);
    $('formulaire').hidden = false;
  }

  demarrer();
})();
