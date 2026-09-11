/* =========================================================================
   LNHQ — <site-header> : en-tête + navigation, communs aux 5 pages du site.
   Rendu en DOM léger (pas de Shadow DOM) : les styles viennent de site.css,
   et les scripts de chaque page peuvent continuer à faire
   document.getElementById('sheetTitle' | 'rowCount' | 'lastUpdated' | ...)
   exactement comme avant.

   Attributs :
   - current-page : "joueurs" | "ordre" | "calendrier" | "masse" (marque
     l'élément courant dans les menus Ligue/Repêchage). Absent pour les
     pages d'équipe.
   - current-team : slug de l'équipe active (ex: "boston"), pour marquer
     l'équipe courante dans le menu Équipes. Peut être posé après coup
     (ex: une fois l'URL ?team=... lue) : le composant se met à jour.
   ========================================================================= */
(function(){
  const TEAM_BASE_URL = 'equipe.html?team=';
  const TEAMS = [
    ['Anaheim', 'anaheim'], ['Boston', 'boston'], ['Buffalo', 'buffalo'],
    ['Calgary', 'calgary'], ['Caroline', 'carolina'], ['Chicago', 'chicago'],
    ['Colorado', 'colorado'], ['Columbus', 'columbus'], ['Dallas', 'dallas'],
    ['Detroit', 'detroit'], ['Edmonton', 'edmonton'], ['Floride', 'florida'],
    ['Los Angeles', 'los-angeles'], ['Minnesota', 'minnesota'], ['Montréal', 'montreal'],
    ['Nashville', 'nashville'], ['New Jersey', 'new-jersey'], ['NY Islanders', 'ny-islanders'],
    ['NY Rangers', 'ny-rangers'], ['Ottawa', 'ottawa'], ['Philadelphie', 'philadelphia'],
    ['Pittsburgh', 'pittsburgh'], ['San Jose', 'san-jose'], ['Seattle', 'seattle'],
    ['St. Louis', 'st-louis'], ['Tampa Bay', 'tampa-bay'], ['Toronto', 'toronto'],
    ['Utah', 'utah'], ['Vancouver', 'vancouver'], ['Vegas', 'vegas'],
    ['Washington', 'washington'], ['Winnipeg', 'winnipeg'],
  ];

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
          <a class="brand" href="https://sites.lnhq.ca">
            <img class="brand-logo" src="logo-lnhq.png" alt="LNHQ">
            <h1 class="app-title" id="sheetTitle">Tableau de bord</h1>
          </a>
          <nav class="site-nav" id="siteNav">
            <a class="nav-btn" href="https://sites.lnhq.ca"><span>Accueil</span></a>

            <div class="nav-item">
              <button class="nav-btn" aria-haspopup="true" aria-expanded="false">
                <span>Ligue</span>
                <svg class="nav-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="nav-dropdown" hidden>
                ${menuItem('Calendrier', 'calendrier.html', currentPage === 'calendrier')}
                <a href="https://sites.lnhq.ca/ligue/dgs">DGs</a>
                <a href="https://sites.lnhq.ca/ligue/règlements">Règlements</a>
                ${menuItem('Masse salariale', 'masse.html', currentPage === 'masse')}
              </div>
            </div>

            <div class="nav-item">
              <button class="nav-btn" aria-haspopup="true" aria-expanded="false">
                <span>Repêchage</span>
                <svg class="nav-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="nav-dropdown" hidden>
                ${menuItem('Joueurs', 'index.html', currentPage === 'joueurs')}
                ${menuItem('Ordre', 'ordre.html', currentPage === 'ordre')}
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
                <a href="https://sites.lnhq.ca/nouvelles/2026-27">2026-27</a>
              </div>
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
