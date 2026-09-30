/* =========================================================================
   LNHQ — <site-header> : en-tête + navigation, communs aux 5 pages du site.
   Rendu en DOM léger (pas de Shadow DOM) : les styles viennent de site.css,
   et les scripts de chaque page peuvent continuer à faire
   document.getElementById('sheetTitle' | 'rowCount' | 'lastUpdated' | ...)
   exactement comme avant.

   Attributs :
   - current-page : "joueurs" | "ordre" | "calendrier" | "masse" | "dgs" | "reglements" | "tv" | "encheres" | "inscription" (marque
     l'élément courant dans les menus Ligue/Agent libre). Absent pour les
     pages d'équipe.
   - current-team : slug de l'équipe active (ex: "boston"), pour marquer
     l'équipe courante dans le menu Équipes. Peut être posé après coup
     (ex: une fois l'URL ?team=... lue) : le composant se met à jour.
   ========================================================================= */
(function(){
  const TEAM_BASE_URL = 'equipe.html?team=';
  // Bouton d'alerte « Accès DGs » dans l'en-tête (inscription des DG, temporaire) :
  // mettre à false pour le retirer de toutes les pages.
  const ALERTE_ACCES_DG = true;
  // [nom affiché, slug de equipe.html, code des fichiers Logos/XXX.png]
  const TEAMS = [
    ['Anaheim', 'anaheim', 'ANA'], ['Boston', 'boston', 'BOS'], ['Buffalo', 'buffalo', 'BUF'],
    ['Calgary', 'calgary', 'CGY'], ['Caroline', 'carolina', 'CAR'], ['Chicago', 'chicago', 'CHI'],
    ['Colorado', 'colorado', 'COL'], ['Columbus', 'columbus', 'CBJ'], ['Dallas', 'dallas', 'DAL'],
    ['Detroit', 'detroit', 'DET'], ['Edmonton', 'edmonton', 'EDM'], ['Floride', 'florida', 'FLA'],
    ['Los Angeles', 'los-angeles', 'LAK'], ['Minnesota', 'minnesota', 'MIN'], ['Montréal', 'montreal', 'MTL'],
    ['Nashville', 'nashville', 'NSH'], ['New Jersey', 'new-jersey', 'NJD'], ['NY Islanders', 'ny-islanders', 'NYI'],
    ['NY Rangers', 'ny-rangers', 'NYR'], ['Ottawa', 'ottawa', 'OTT'], ['Philadelphie', 'philadelphia', 'PHI'],
    ['Pittsburgh', 'pittsburgh', 'PIT'], ['San Jose', 'san-jose', 'SJS'], ['Seattle', 'seattle', 'SEA'],
    ['St. Louis', 'st-louis', 'STL'], ['Tampa Bay', 'tampa-bay', 'TBL'], ['Toronto', 'toronto', 'TOR'],
    ['Utah', 'utah', 'UTA'], ['Vancouver', 'vancouver', 'VAN'], ['Vegas', 'vegas', 'VGK'],
    ['Washington', 'washington', 'WSH'], ['Winnipeg', 'winnipeg', 'WPG'],
  ];
  window.LNHQ_TEAMS = Object.freeze(TEAMS.map(([name, slug, code]) => Object.freeze({ name, slug, code })));

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
    }[c]));
  }

  // Un item de menu : lien normal, ou <span> non cliquable pour la page courante.
  function menuItem(label, href, isCurrent){
    return isCurrent
      ? `<span class="nav-dropdown-current" aria-current="page">${escapeHtml(label)}</span>`
      : `<a href="${href}">${escapeHtml(label)}</a>`;
  }

  class SiteHeader extends HTMLElement{
    static get observedAttributes(){ return ['current-page', 'current-team']; }

    connectedCallback(){
      if(!this.hasAttribute('role')) this.setAttribute('role', 'banner');
      this.render();
      if(!this._docListenersWired){
        this._docListenersWired = true;
        document.addEventListener('click', () => this._closeAllDropdowns());
        document.addEventListener('keydown', e => {
          if(e.key === 'Escape') this._closeAllDropdowns();
        });
      }
    }

    attributeChangedCallback(){
      if(!this.isConnected) return;
      // Une fois construit, on ne reconstruit plus tout le header (ça détruirait
      // #sheetTitle/#rowCount/#lastUpdated que le script de la page a déjà mis en
      // cache par getElementById) : on met juste à jour le menu Équipes.
      if(this._built) this._updateTeamsDropdown();
      else this.render();
    }

    render(){
      const currentPage = this.getAttribute('current-page') || '';
      const currentTeam = this.getAttribute('current-team') || '';

      const teamsHtml = TEAMS.map(([name, slug]) =>
        menuItem(name, TEAM_BASE_URL + slug, slug === currentTeam)
      ).join('');

      this.innerHTML = `
        <div class="header-row">
          <a class="brand" href="./">
            <img class="brand-logo" src="logo-lnhq.png" alt="LNHQ">
            <h1 class="app-title" id="sheetTitle">Tableau de bord</h1>
          </a>
          ${ALERTE_ACCES_DG ? `<a class="alerte-dg" href="inscription.html"${currentPage === 'inscription' ? ' aria-current="page"' : ''}><span class="alerte-dg-point"></span>Accès DGs</a>` : ''}
          <nav class="site-nav" id="siteNav">
            <a class="nav-btn" href="./"><span>Accueil</span></a>
            <a class="nav-btn" href="tv.html"${currentPage === 'tv' ? ' aria-current="page"' : ''}><span>TV</span></a>

            <div class="nav-item">
              <button class="nav-btn" aria-haspopup="true" aria-expanded="false">
                <span>Ligue</span>
                <svg class="nav-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="nav-dropdown" hidden>
                ${menuItem('Calendrier', 'calendrier.html', currentPage === 'calendrier')}
                ${menuItem('DGs', 'dgs.html', currentPage === 'dgs')}
                ${menuItem('Règlements', 'reglements.html', currentPage === 'reglements')}
                ${menuItem('Masse salariale', 'masse.html', currentPage === 'masse')}
                ${menuItem('Draft 2026', 'ordre.html', currentPage === 'ordre')}
              </div>
            </div>

            <div class="nav-item">
              <button class="nav-btn" aria-haspopup="true" aria-expanded="false">
                <span>Agent libre</span>
                <svg class="nav-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="nav-dropdown" hidden>
                ${menuItem('Joueurs', 'joueurs.html', currentPage === 'joueurs')}
                ${menuItem('Enchères', 'encheres.html', currentPage === 'encheres')}
              </div>
            </div>

            <div class="nav-item">
              <button class="nav-btn" aria-haspopup="true" aria-expanded="false">
                <span>Équipes</span>
                <svg class="nav-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="nav-dropdown teams-grid" id="teamsDropdown" hidden>${teamsHtml}</div>
            </div>

            <div class="nav-item">
              <button class="nav-btn" aria-haspopup="true" aria-expanded="false">
                <span>Nouvelles</span>
                <svg class="nav-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="nav-dropdown" hidden>
                <a href="./?fil=annonces">Annonces</a>
                <a href="./?fil=nouvelles">Nouvelles</a>              </div>
            </div>
          </nav>
        </div>
        <div class="meta-row">
          <span id="rowCount" aria-live="polite"></span>
          <span id="lastUpdated"></span>
        </div>
      `;
      this.querySelectorAll('.nav-item').forEach(item => {
        const btn = item.querySelector(':scope > .nav-btn');
        const menu = item.querySelector(':scope > .nav-dropdown');
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const willOpen = menu.hidden;
          this._closeAllDropdowns();
          if(willOpen){ menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
        });
      });
      this._built = true;
    }

    // Ne touche qu'au contenu du menu Équipes, pour ne jamais détruire les
    // éléments (#sheetTitle, #rowCount, #lastUpdated...) que le script de la
    // page a pu référencer par getElementById avant ce changement d'attribut.
    _updateTeamsDropdown(){
      const currentTeam = this.getAttribute('current-team') || '';
      const dropdown = this.querySelector('#teamsDropdown');
      if(!dropdown) return;
      dropdown.innerHTML = TEAMS.map(([name, slug]) =>
        menuItem(name, TEAM_BASE_URL + slug, slug === currentTeam)
      ).join('');
    }

    _closeAllDropdowns(){
      this.querySelectorAll('.nav-dropdown').forEach(m => { m.hidden = true; });
      this.querySelectorAll('.nav-item > .nav-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
    }
  }

  customElements.define('site-header', SiteHeader);
})();
