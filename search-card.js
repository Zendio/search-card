const BUILTIN_ACTIONS = [
  {
    matches: "^((magnet:.*)|(.*.torrent.*))$",
    name: "Add to Transmission",
    icon: "mdi:progress-download",
    service: "transmission.add_torrent",
    service_data: {
      torrent: "{1}",
    },
  },
];

const matchAndReplace = (text, matches) => {
  for (var i = 0; i < matches.length; i++) {
    text = text.replace("{" + i + "}", matches[i]);
  }
  return text;
};

class SearchCard extends HTMLElement {
  constructor() {
    super();
    this._results = [];
    this._activeActions = [];
    this._searchValue = "";
    this._hass = null;
    this._config = null;
    this.attachShadow({ mode: "open" });
    this._debouncedSearch = this._debounce((searchText) => {
      this._performSearch(searchText);
    }, 100);
  }

  set hass(hass) {
    this._hass = hass;
    // Update state icons live
    this.shadowRoot.querySelectorAll("state-badge").forEach((badge) => {
      const entityId = badge.dataset.entity;
      if (entityId && hass.states[entityId]) {
        badge.stateObj = hass.states[entityId];
        badge.hass = hass;
      }
    });
    // Update state values live
    this.shadowRoot.querySelectorAll(".entity-state").forEach((el) => {
      const entityId = el.dataset.entity;
      if (entityId && hass.states[entityId]) {
        el.textContent = this._formatState(hass.states[entityId]);
      }
    });
  }

  setConfig(config) {
    this._config = config;
    this._maxResults = config.max_results || 10;
    this._searchText = config.search_text || "Type to search...";
    this._actions = BUILTIN_ACTIONS.concat(config.actions || []);
    this._includedDomains = config.included_domains;
    this._excludedDomains = config.excluded_domains || [];
    this._render();
  }

  getCardSize() {
    return 4;
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        /* ── Card shell ── */
        ha-card {
          overflow: hidden;
        }

        /* ── Search area: native card-content padding ── */
        #searchContainer {
          padding: 16px 16px 8px 16px;
        }

        #searchTextFieldContainer {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        ha-textfield {
          flex-grow: 1;
        }

        #clearBtn {
          flex-shrink: 0;
          color: var(--secondary-text-color);
          --mdc-icon-button-size: 36px;
          --mdc-icon-size: 20px;
        }

        #count {
          text-align: right;
          font-style: italic;
          font-size: 12px;
          color: var(--secondary-text-color);
          padding: 4px 0 0 0;
          min-height: 18px;
        }

        /* ── Results area: mirrors card-content 16px padding ── */
        #results {
          padding: 0 16px 16px 16px;
        }

        /* ── Entity row: exact match to native hui-*-entity-row ── */
        .entity-row {
          display: flex;
          align-items: center;
          height: 40px;
          cursor: pointer;
          border-radius: var(--ha-card-border-radius, 12px);
          transition: background-color 0.12s ease;
          /* negative side margin so hover bg bleeds to edges, then compensate */
          margin: 0 -4px;
          padding: 0 4px;
        }

        .entity-row:hover {
          background-color: rgba(var(--rgb-primary-text-color, 0,0,0), 0.05);
        }

        /* state-badge is 40x40, no extra margin needed */
        .entity-row state-badge {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
        }

        /* Info block: padding-left 16px padding-right 8px, exact native values */
        .entity-info {
          flex: 1 1 auto;
          min-width: 0;
          padding: 0 8px 0 16px;
          font-size: 14px;
          line-height: 22.4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--primary-text-color);
        }

        /* State value: right-aligned, same font as native */
        .entity-state {
          flex-shrink: 0;
          font-size: 14px;
          line-height: 22.4px;
          color: var(--primary-text-color);
          text-align: right;
          white-space: nowrap;
        }

        /* ── Action row ── */
        .action-row {
          display: flex;
          align-items: center;
          height: 40px;
          cursor: pointer;
          border-radius: var(--ha-card-border-radius, 12px);
          transition: background-color 0.12s ease;
          margin: 0 -4px;
          padding: 0 4px;
        }

        .action-row:hover {
          background-color: rgba(var(--rgb-primary-text-color, 0,0,0), 0.05);
        }

        .action-icon {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--paper-item-icon-color, var(--state-icon-color, #44739e));
          --mdc-icon-size: 24px;
        }

        .action-name {
          flex: 1;
          padding: 0 8px 0 16px;
          font-size: 14px;
          line-height: 22.4px;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>

      <ha-card>
        <div id="searchContainer">
          <div id="searchTextFieldContainer">
            <ha-textfield
              id="searchText"
              type="text"
              autocomplete="off"
              label="${this._searchText}"
            ></ha-textfield>
            <ha-icon-button id="clearBtn" title="Clear">
              <ha-icon icon="mdi:close"></ha-icon>
            </ha-icon-button>
          </div>
          <div id="count"></div>
        </div>
        <div id="results"></div>
      </ha-card>
    `;

    this.shadowRoot.getElementById("searchText").addEventListener("input", (e) => {
      this._searchValue = e.target.value;
      this._debouncedSearch(this._searchValue);
    });

    this.shadowRoot.getElementById("clearBtn").addEventListener("click", () => {
      this._searchValue = "";
      this.shadowRoot.getElementById("searchText").value = "";
      this._results = [];
      this._activeActions = [];
      this._renderResults();
    });
  }

  _renderResults() {
    const resultsContainer = this.shadowRoot.getElementById("results");
    const countContainer = this.shadowRoot.getElementById("count");
    if (!resultsContainer) return;

    const results = this._results.slice(0, this._maxResults).sort();

    countContainer.textContent = results.length > 0
      ? `Showing ${results.length} of ${this._results.length} results`
      : "";

    resultsContainer.innerHTML = "";

    for (const [action, matches] of this._activeActions) {
      resultsContainer.appendChild(this._createActionRow(action, matches));
    }

    for (const entity_id of results) {
      resultsContainer.appendChild(this._createEntityRow(entity_id));
    }
  }

  _createEntityRow(entity_id) {
    const state = this._hass?.states[entity_id];
    const friendlyName = state?.attributes?.friendly_name || entity_id;
    const stateValue = this._formatState(state);

    const row = document.createElement("div");
    row.className = "entity-row";

    // state-badge (native HA element, 40x40, handles icon + color)
    const badge = document.createElement("state-badge");
    badge.dataset.entity = entity_id;
    badge.stateObj = state;
    badge.hass = this._hass;

    // Entity name
    const info = document.createElement("div");
    info.className = "entity-info";
    info.textContent = friendlyName;

    // State value
    const stateEl = document.createElement("div");
    stateEl.className = "entity-state";
    stateEl.dataset.entity = entity_id;
    stateEl.textContent = stateValue;

    row.appendChild(badge);
    row.appendChild(info);
    row.appendChild(stateEl);

    row.addEventListener("click", () => this._fireMoreInfo(entity_id));

    return row;
  }

  _formatState(state) {
    if (!state) return "";
    const unit = state.attributes?.unit_of_measurement;
    if (unit) return `${state.state} ${unit}`;
    return state.state;
  }

  _createActionRow(action, matches) {
    const row = document.createElement("div");
    row.className = "action-row";

    const iconArea = document.createElement("div");
    iconArea.className = "action-icon";
    const haIcon = document.createElement("ha-icon");
    haIcon.setAttribute("icon", action.icon || "mdi:lamp");
    iconArea.appendChild(haIcon);

    const name = document.createElement("div");
    name.className = "action-name";
    name.textContent = matchAndReplace(action.name, matches);

    row.appendChild(iconArea);
    row.appendChild(name);

    row.addEventListener("click", () => {
      const service_data = {};
      for (var key in action.service_data) {
        service_data[key] = matchAndReplace(action.service_data[key], matches);
      }
      const [domain, service] = action.service.split(".");
      this._hass.callService(domain, service, service_data);
    });

    return row;
  }

  _fireMoreInfo(entityId) {
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      composed: true,
      bubbles: true,
      detail: { entityId },
    }));
  }

  _performSearch(searchText) {
    if (!this._config || !this._hass || searchText === "") {
      this._results = [];
      this._activeActions = [];
      this._renderResults();
      return;
    }

    try {
      const searchRegex = new RegExp(searchText, "i");
      const newResults = [];

      for (const entity_id in this._hass.states) {
        if (
          (entity_id.search(searchRegex) >= 0 ||
            this._hass.states[entity_id].attributes.friendly_name?.search(searchRegex) >= 0) &&
          (this._includedDomains
            ? this._includedDomains.includes(entity_id.split(".")[0])
            : !this._excludedDomains.includes(entity_id.split(".")[0]))
        ) {
          newResults.push(entity_id);
        }
      }

      this._results = newResults;
      this._activeActions = this._getActivatedActions(searchText);
    } catch (err) {
      console.warn(err);
      this._results = [];
      this._activeActions = [];
    }

    this._renderResults();
  }

  _getActivatedActions(searchText) {
    const active = [];
    for (const action of this._actions) {
      if (this._serviceExists(action.service)) {
        const matches = searchText.match(action.matches);
        if (matches != null) {
          active.push([action, matches]);
        }
      }
    }
    return active;
  }

  _serviceExists(serviceCall) {
    const [domain, service] = serviceCall.split(".");
    const servicesForDomain = this._hass?.services[domain];
    return servicesForDomain && service in servicesForDomain;
  }

  _debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
}

customElements.define("search-card", SearchCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "search-card",
  name: "Search Card",
  preview: true,
  description: "Card to search entities",
});
