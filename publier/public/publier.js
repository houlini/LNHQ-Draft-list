/* LNHQ — éditeur de publication (publier.lnhq.ca). L'accès est déjà filtré par
   Cloudflare Access ; /api/moi indique l'équipe et le droit de publier des annonces. */
(function(){
  const $ = id => document.getElementById(id);
  const COTE_MAX = 1600;
  const QUALITE_JPEG = 0.85;
  const TEXTE_MAX = 45000;   // même valeur que dans le script (cellule Sheets : 50 000 max)
  // Même palette que nouvelles.js, qui refuse toute autre couleur à l'affichage.
  const COULEURS = ['#E8590C', '#E03131', '#2F9E44', '#1C7ED6', '#E0A800', '#868E96'];
  const PAGES = { NOUVELLES: 'https://lnhq.ca/?fil=nouvelles', ANNONCES: 'https://lnhq.ca/?fil=annonces' };
  const ERREURS = {
    acces: 'Accès refusé : ta session de connexion n’est plus valide.',
    session: "Ta session a peut-être expiré. Recharge la page pour te reconnecter, ton texte sera perdu : copie-le d'abord.",
    inconnu: "Ton courriel n'est pas dans la liste d'accès de la ligue. Contacte le dirigeant de la ligue.",
    annonces: "Tu n'as pas le droit de publier une annonce.",
    vide: 'Le titre et le texte sont obligatoires.',
    photo: "L'image n'a pas pu être enregistrée.",
    taille: "L'image est trop lourde.",
    dirigeant: 'Seuls les dirigeants de la ligue peuvent modifier une publication.',
    introuvable: 'Publication introuvable : elle a peut-être été retirée du classeur.',
    long: `Le texte est trop long (maximum ${TEXTE_MAX.toLocaleString('fr-CA')} caractères) : sépare-le en deux parties.`,
  };

  // Types et modèles de chaque fil (Markdown, comme le texte de l'éditeur). Pas de
  // tableau dans les modèles d'annonces : Discord ne sait pas les afficher.
  const MODELES = { NOUVELLES: {
    'Général': '',
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
  }, ANNONCES: {
    'Général': '',
    'Règlement': [
      '## Ce qui change', '', '- ', '',
      '**En vigueur :** ', '',
      '## Pourquoi', '', 'Explication pour les DG.',
    ].join('\n'),
    'Calendrier': [
      '## Dates importantes', '',
      '- **Date** : événement', '- **Date** : événement', '',
      '## À faire avant', '', '- ',
    ].join('\n'),
    'Événement': [
      '## Quoi', '', 'Description de l’événement.', '',
      '## Quand', '', '**Date :** ', '', '**Heure :** ', '',
      '## Détails', '', '- ',
    ].join('\n'),
  } };
  let dernierModele = '';

  let couverture = null; // { blob, url } nouvelle image, ou { existante: true, url }
  let envoisEnCours = 0;
  let editeur = null;
  let moi = null;
  let modification = null; // { id, flux, equipe } quand on modifie une publication (?modifier=id)

  async function api(chemin, options){
    try{
      const rep = await fetch(chemin, options);
      return await rep.json();
    }catch(err){
      // Access renvoie sa page de connexion (pas du JSON) quand la session a expiré.
      return { ok: false, erreur: 'session' };
    }
  }

  // liens : [[texte, adresse], ...] ajoutés après le message.
  function afficher(texte, erreur, liens){
    const msg = $('message');
    msg.className = 'pub-message' + (erreur ? ' is-erreur' : ' is-succes');
    msg.textContent = texte;
    (liens || []).forEach(([libelle, href]) => {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = libelle;
      if(!href.startsWith('?')){ a.target = '_blank'; a.rel = 'noopener'; }
      msg.append(' ', a);
    });
    msg.hidden = false;
  }

  function fluxChoisi(){
    if(modification) return modification.flux;
    const coche = document.querySelector('input[name="flux"]:checked');
    return coche ? coche.value : 'NOUVELLES';
  }

  function majQui(){
    const flux = fluxChoisi();
    // Une modification garde l'équipe d'origine de la publication, pas celle du dirigeant.
    if(modification) $('qui').textContent = 'Modification · publication de ' + (modification.equipe || 'la ligue');
    else if(flux === 'ANNONCES') $('qui').textContent = 'Annonce signée : Commissaire de la ligue';
    else $('qui').textContent = moi.equipe === 'Ligue' ? 'Tu publies au nom de la ligue' : 'Tu publies pour ' + moi.equipe;
    $('lienFil').href = PAGES[flux];
  }

  // Les types (et leurs modèles) ne sont pas les mêmes pour les nouvelles et les annonces.
  function remplirTypes(choisi){
    const types = Object.keys(MODELES[fluxChoisi()]);
    $('type').replaceChildren(...types.map(t => new Option(t, t)));
    $('type').value = types.includes(choisi) ? choisi : 'Général';
  }

  function changerFlux(){
    remplirTypes('Général');
    appliquerModele();
    majQui();
  }

  function lienPage(page){
    return /^https:\/\/lnhq\.ca\//.test(page || '') ? page : null;
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
    bouton.textContent = envoisEnCours > 0 ? 'Envoi de l’image…' : modification ? 'Enregistrer les modifications' : 'Publier';
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
      if(couverture.blob) URL.revokeObjectURL(couverture.url);
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

  /* ---------- Nettoyage du texte collé ---------- */
  // Un texte copié d'une page web arrive avec son code de mise en forme
  // (<span style="color: rgb(...); font-family: ...">). On ne garde que les
  // <span> de couleur de la palette ; les autres balises sont retirées, le texte reste.
  function nettoyerSpans(md){
    const garde = [];
    return md.replace(/<span\b[^>]*>|<\/span>/gi, balise => {
      if(balise[1] === '/') return garde.pop() ? balise : '';
      const couleur = /^<span style="color:\s*(#[0-9a-f]{6})\s*;?"\s*>$/i.exec(balise);
      const ok = !!couleur && COULEURS.includes(couleur[1].toUpperCase());
      garde.push(ok);
      return ok ? balise : '';
    });
  }

  function nettoyerEditeur(){
    const avant = editeur.getMarkdown();
    const apres = nettoyerSpans(avant);
    if(apres !== avant) editeur.setMarkdown(apres, false);
  }

  /* ---------- Modèle selon le type ---------- */
  // Remplace le texte seulement s'il est vide ou encore identique au modèle précédent ;
  // sinon, on demande avant d'écraser ce que la personne a écrit.
  function appliquerModele(){
    const modele = MODELES[fluxChoisi()][$('type').value] || '';
    const actuel = editeur.getMarkdown().trim();
    const intact = !actuel || actuel === dernierModele;
    if(!intact && !modele) return;
    if(!intact && !confirm('Remplacer ton texte par le modèle « ' + $('type').value + ' » ?')) return;
    editeur.setMarkdown(modele, false);
    dernierModele = editeur.getMarkdown().trim();
  }

  /* ---------- Placement et taille d'une image dans le texte ---------- */
  // Notés à la fin de l'adresse (#droite-30, #centre-60…) : le site et l'éditeur
  // l'appliquent par CSS, et l'image se charge normalement. Sans suffixe : pleine largeur.
  const POSITIONS = [['', 'Pleine largeur'], ['gauche', 'Gauche'], ['centre', 'Centre'], ['droite', 'Droite']];
  const TAILLES = [['30', 'Petite'], ['45', 'Moyenne'], ['60', 'Grande']];
  const TAILLE_DEFAUT = { gauche: '45', droite: '45', centre: '60' };
  const barrePlacement = document.createElement('div');
  barrePlacement.className = 'pub-placement';
  barrePlacement.hidden = true;
  document.body.append(barrePlacement);
  let imageChoisie = '';
  let placement = { position: '', taille: '' };

  function echapperRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function appliquerPlacement(){
    const suffixe = placement.position ? '#' + placement.position + '-' + placement.taille : '';
    const motif = new RegExp('\\(' + echapperRegex(imageChoisie) + '(#[a-z0-9-]*)?\\)', 'g');
    editeur.setMarkdown(editeur.getMarkdown().replace(motif, '(' + imageChoisie + suffixe + ')'), false);
    barrePlacement.hidden = true;
  }

  function rangee(choix, cle){
    const ligne = document.createElement('div');
    choix.forEach(([valeur, texte]) => {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.textContent = texte;
      bouton.dataset[cle] = valeur;
      bouton.addEventListener('click', () => {
        placement[cle] = valeur;
        if(cle === 'position') placement.taille = valeur ? (placement.taille || TAILLE_DEFAUT[valeur]) : '';
        appliquerPlacement();
      });
      ligne.append(bouton);
    });
    barrePlacement.append(ligne);
  }
  rangee(POSITIONS, 'position');
  rangee(TAILLES, 'taille');

  $('editeur').addEventListener('click', e => {
    const img = e.target.closest('.toastui-editor-ww-container img');
    // Les logos d'équipe restent dans la ligne de texte : pas de placement ni de taille.
    if(!img || /#logo$/.test(img.getAttribute('src') || '')){ barrePlacement.hidden = true; return; }
    const src = img.getAttribute('src') || '';
    imageChoisie = src.replace(/#.*$/, '');
    // Ancien format sans taille (#droite) : taille moyenne.
    const m = /#(gauche|droite|centre)(?:-(30|45|60))?$/.exec(src);
    placement = m ? { position: m[1], taille: m[2] || TAILLE_DEFAUT[m[1]] } : { position: '', taille: '' };
    barrePlacement.querySelectorAll('button').forEach(b => {
      const actif = b.dataset.position !== undefined ? b.dataset.position === placement.position : b.dataset.taille === placement.taille;
      b.classList.toggle('is-actif', actif);
      // Pleine largeur : pas de taille à choisir.
      if(b.dataset.taille !== undefined) b.disabled = !placement.position;
    });
    const r = img.getBoundingClientRect();
    barrePlacement.hidden = false;
    barrePlacement.style.left = Math.max(8, Math.min(r.left, innerWidth - barrePlacement.offsetWidth - 8)) + 'px';
    barrePlacement.style.top = Math.max(8, r.top - barrePlacement.offsetHeight - 6) + 'px';
  });
  document.addEventListener('scroll', () => { barrePlacement.hidden = true; }, true);

  /* ---------- Menu « Taille » de la barre d'outils ---------- */
  /* ---------- Menu « Logo » : insère un logo d'équipe dans la ligne de texte ---------- */
  // Adresse terminée par #logo : le site et l'éditeur l'affichent à la hauteur du texte.
  const EQUIPES = [
    ['ANA', 'Anaheim'], ['BOS', 'Boston'], ['BUF', 'Buffalo'], ['CGY', 'Calgary'], ['CAR', 'Caroline'],
    ['CHI', 'Chicago'], ['COL', 'Colorado'], ['CBJ', 'Columbus'], ['DAL', 'Dallas'], ['DET', 'Detroit'],
    ['EDM', 'Edmonton'], ['FLA', 'Floride'], ['LAK', 'Los Angeles'], ['MIN', 'Minnesota'], ['MTL', 'Montréal'],
    ['NSH', 'Nashville'], ['NJD', 'New Jersey'], ['NYI', 'NY Islanders'], ['NYR', 'NY Rangers'], ['OTT', 'Ottawa'],
    ['PHI', 'Philadelphie'], ['PIT', 'Pittsburgh'], ['SJS', 'San Jose'], ['SEA', 'Seattle'], ['STL', 'St. Louis'],
    ['TBL', 'Tampa Bay'], ['TOR', 'Toronto'], ['UTA', 'Utah'], ['VAN', 'Vancouver'], ['VGK', 'Vegas'],
    ['WSH', 'Washington'], ['WPG', 'Winnipeg'],
  ];
  function menuLogos(){
    const grille = document.createElement('div');
    grille.className = 'pub-menu-logos';
    const choix = EQUIPES.map(([code, nom]) => [nom, 'https://lnhq.ca/Logos/' + code + '.png'])
      .concat([['LNHQ', 'https://lnhq.ca/logo-lnhq.png']]);
    choix.forEach(([nom, src]) => {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.title = nom;
      bouton.setAttribute('aria-label', 'Logo ' + nom);
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      bouton.append(img);
      bouton.addEventListener('click', () => {
        editeur.exec('addImage', { imageUrl: src + '#logo', altText: nom });
        editeur.eventEmitter.emit('closePopup');
        editeur.focus();
      });
      grille.append(bouton);
    });
    return {
      name: 'logos',
      tooltip: "Logo d'équipe",
      text: 'Logo',
      className: 'pub-bouton-taille toastui-editor-toolbar-icons',
      style: { backgroundImage: 'none', width: 'auto', padding: '0 8px', fontWeight: '700', fontSize: '13px' },
      popup: { body: grille, style: { width: 'auto' } },
    };
  }

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

  // Compteur de caractères sous l'éditeur (en rouge au-delà de la limite).
  let minuterieCompteur = 0;
  function majCompteur(){
    clearTimeout(minuterieCompteur);
    minuterieCompteur = setTimeout(() => {
      const n = editeur.getMarkdown().trim().length;
      const c = $('compteur');
      c.textContent = `${n.toLocaleString('fr-CA')} / ${TEXTE_MAX.toLocaleString('fr-CA')} caractères`;
      c.classList.toggle('is-trop', n > TEXTE_MAX);
    }, 300);
  }

  /* ---------- Envoi ---------- */
  $('formulaire').addEventListener('submit', async e => {
    e.preventDefault();
    if(envoisEnCours > 0) return;
    const titre = $('titre').value.trim();
    const texte = nettoyerSpans(editeur.getMarkdown()).trim();
    if(!titre || !texte){ afficher(ERREURS.vide, true); return; }
    if(texte.length > TEXTE_MAX){ afficher(ERREURS.long, true); return; }

    const bouton = $('envoyer');
    bouton.disabled = true;
    bouton.textContent = modification ? 'Enregistrement…' : 'Publication en cours…';
    $('message').hidden = true;

    const flux = fluxChoisi();
    const image = !couverture ? null
      : couverture.existante ? 'garder'
      : { mime: 'image/jpeg', data: await enBase64(couverture.blob) };
    const r = await api(modification ? '/api/modifier' : '/api/publier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign(modification ? { id: modification.id } : { flux },
        { titre, type: $('type').value, texte, couverture: image })),
    });

    const page = r.ok ? lienPage(r.page) : null;
    const liens = page ? [['Voir la publication', page]] : [];
    if(page && moi.annonces) liens.push(['Modifier', '?modifier=' + encodeURIComponent(r.id)]);
    if(r.ok && modification){
      afficher(r.discord === false ? "Modifications enregistrées sur le site, mais Discord a refusé la mise à jour."
        : r.discord === null ? 'Modifications enregistrées sur le site (cette publication n’est pas sur Discord).'
        : 'Modifications enregistrées sur le site et sur Discord.', r.discord === false, liens.slice(0, 1));
      if(couverture) couverture.existante = true; // déjà envoyée : ne pas la renvoyer au prochain enregistrement
    }else if(r.ok){
      const quoi = flux === 'ANNONCES' ? 'Annonce publiée' : 'Nouvelle publiée';
      afficher(r.discord === false
        ? quoi + " sur le site, mais Discord l'a refusée. Préviens le dirigeant de la ligue."
        : quoi + ' sur le site et sur Discord.',
        r.discord === false, liens);
      $('titre').value = '';
      editeur.setMarkdown('');
      dernierModele = '';
      $('type').value = 'Général';
      if(couverture && couverture.blob) URL.revokeObjectURL(couverture.url);
      couverture = null;
      dessinerCouverture();
    }else{
      afficher(ERREURS[r.erreur] || 'La publication a échoué. Réessaie dans un instant.', true);
    }
    majBouton();
  });

  // Dirigeants : renvoie à Discord la dernière publication de chaque fil qui n'y est pas arrivée.
  $('reessayer').addEventListener('click', async () => {
    const bouton = $('reessayer');
    bouton.disabled = true;
    const r = await api('/api/reessayer', { method: 'POST' });
    bouton.disabled = false;
    if(!r.ok){ afficher(ERREURS[r.erreur] || 'Impossible de joindre Discord pour le moment.', true); return; }
    if(!r.resultats.length){ afficher('Rien à renvoyer : tout est déjà sur Discord.', false); return; }
    const echecs = r.resultats.filter(x => !x.ok);
    afficher(r.resultats.map(x => `« ${x.titre} » : ${x.ok ? 'envoyée sur Discord' : x.erreur}`).join(' — '), echecs.length > 0);
  });

  /* ---------- Démarrage ---------- */
  async function demarrer(){
    moi = await api('/api/moi');
    if(!moi.ok){
      $('qui').textContent = '';
      $('refusTexte').textContent = ERREURS[moi.erreur] || 'Accès impossible pour le moment. Réessaie plus tard.';
      // Session périmée : le Worker a effacé le jeton ; en rechargeant, Access
      // redemande un code par courriel.
      if(moi.erreur === 'acces' || moi.erreur === 'session'){
        const lien = document.createElement('a');
        lien.href = '/';
        lien.textContent = 'Se reconnecter';
        $('refusTexte').append(' ', lien);
      }
      $('refus').hidden = false;
      return;
    }
    $('choixFlux').hidden = !moi.annonces;
    $('reessayer').hidden = !moi.annonces;
    document.querySelectorAll('input[name="flux"]').forEach(r => r.addEventListener('change', changerFlux));
    remplirTypes('Général');
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
        [menuTaille(), 'bold', 'italic', 'strike', menuLogos()],
        ['hr', 'quote'],
        ['ul', 'ol'],
        ['table', 'image', 'link'],
      ],
      hooks: { addImageBlobHook: imageDansLeTexte },
    });
    $('type').addEventListener('change', appliquerModele);
    $('editeur').addEventListener('paste', () => setTimeout(nettoyerEditeur, 0));
    editeur.on('change', majCompteur);

    const idModif = new URLSearchParams(location.search).get('modifier');
    if(idModif) await chargerModification(idModif);
    majCompteur();
    if(moi.annonces) listerRecentes(idModif);
    $('formulaire').hidden = false;
  }

  // Dirigeants : liste des publications récentes ; en choisir une ouvre sa modification.
  async function listerRecentes(idActuel){
    const r = await api('/api/recentes');
    if(!r.ok) return;
    const date = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short' });
    const choix = $('choixModif');
    r.publications.forEach(p => {
      const quand = p.date ? ' · ' + date.format(new Date(p.date)) : '';
      choix.append(new Option(`${p.titre} — ${p.flux === 'ANNONCES' ? 'Annonce' : p.equipe}${quand}`, p.id));
    });
    choix.value = r.publications.some(p => p.id === idActuel) ? idActuel : '';
    choix.addEventListener('change', () => {
      if(!modification && editeur.getMarkdown().trim() && !confirm('Ouvrir cette publication ? Ton texte en cours sera perdu.')){
        choix.value = '';
        return;
      }
      location.href = choix.value ? '?modifier=' + encodeURIComponent(choix.value) : location.pathname;
    });
    $('zoneModif').hidden = false;
  }

  // Lien « Modifier » (?modifier=id) : l'éditeur se remplit avec la publication existante.
  async function chargerModification(id){
    $('qui').textContent = 'Chargement de la publication…';
    const r = await api('/api/article?id=' + encodeURIComponent(id));
    if(!r.ok){
      majQui();
      afficher(ERREURS[r.erreur] || 'Impossible de charger cette publication.', true);
      return;
    }
    modification = { id: r.id, flux: r.flux, equipe: r.equipe };
    $('choixFlux').hidden = true;
    remplirTypes(r.type);
    $('titre').value = r.titre;
    editeur.setMarkdown(r.texte, false);
    dernierModele = '';
    couverture = r.couverture ? { existante: true, url: r.couverture } : null;
    dessinerCouverture();
    majQui();
    majBouton();
  }

  demarrer();
})();
