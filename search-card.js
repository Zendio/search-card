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
    this.shadowRoot.querySelectorAll("state-badge").forEach((badge) => {
      const entityId = badge.dataset.entity;
      if (entityId && hass.states[entityId]) {
        badge.stateObj = hass.states[entityId];
        badge.hass = hass;
      }
    });
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
    this._searchText = config.search_text || "Search entities…";
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
        :host { display: block; }

        ha-card {
          background: transparent !important;
          box-shadow: none !important;
          border: none !important;
        }

        /* ── Search bar area ── */
        #searchContainer {
          padding: 0;
        }

        /* Search wrap als kaart — zelfde look als andere HA kaarten */
        #searchWrap {
          display: flex;
          align-items: center;
          height: 56px;
          border-radius: 28px;
          padding: 0 4px 0 16px;
          background: var(--card-background-color, #fff);
          box-shadow: var(--ha-card-box-shadow, 0 2px 2px 0 rgba(0,0,0,.14), 0 1px 5px 0 rgba(0,0,0,.12), 0 3px 1px -2px rgba(0,0,0,.2));
          transition: box-shadow 0.15s ease;
          box-sizing: border-box;
        }

        #searchWrap:focus-within {
          box-shadow: 0 2px 8px 0 rgba(0,0,0,.18), 0 1px 5px 0 rgba(0,0,0,.14), 0 0 0 2px var(--mdc-theme-primary, #009ac7);
        }

        #searchIcon {
          flex-shrink: 0;
          color: var(--input-label-ink-color, rgba(0,0,0,0.6));
          --mdc-icon-size: 20px;
          margin-right: 8px;
          display: flex;
          align-items: center;
        }

        #searchInput {
          flex: 1;
          border: none;
          outline: none;
          background: transparent;
          font-family: inherit;
          font-size: 16px;
          line-height: 24px;
          color: var(--primary-text-color, rgba(0,0,0,0.87));
          caret-color: var(--mdc-theme-primary, #009ac7);
          min-width: 0;
        }

        #searchInput::placeholder {
          color: var(--input-label-ink-color, rgba(0,0,0,0.6));
        }

        #clearBtn {
          flex-shrink: 0;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.15s ease;
          color: var(--input-label-ink-color, rgba(0,0,0,0.6));
          --mdc-icon-button-size: 36px;
          --mdc-icon-size: 18px;
          cursor: pointer;
          background: none;
          border: none;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: 50%;
        }

        #clearBtn.visible {
          opacity: 1;
          pointer-events: auto;
        }

        #clearBtn:hover {
          background: rgba(var(--rgb-primary-text-color, 0,0,0), 0.06);
        }

        #count {
          text-align: right;
          font-style: italic;
          font-size: 12px;
          color: var(--secondary-text-color);
          padding: 4px 0 0 0;
        }

        /* ── Results ── */
        #results:empty {
          display: none;
        }
        #results {
          padding: 8px 0 0 0;
        }
        #count:empty {
          display: none;
        }

        /* ── Entity row: exact native HA sizing ── */
        .entity-row {
          display: flex;
          align-items: center;
          height: 40px;
          cursor: pointer;
          border-radius: 8px;
          transition: background-color 0.12s ease;
          margin: 0 -8px;
          padding: 0 8px;
        }

        .entity-row:hover {
          background-color: rgba(var(--rgb-primary-text-color, 0,0,0), 0.05);
        }

        .entity-row state-badge {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
        }

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
          border-radius: 8px;
          transition: background-color 0.12s ease;
          margin: 0 -8px;
          padding: 0 8px;
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
          color: var(--paper-item-icon-color, #44739e);
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
          <div id="searchWrap">
            <span id="searchIcon">
              <ha-icon icon="mdi:magnify"></ha-icon>
            </span>
            <input
              id="searchInput"
              type="text"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="${this._searchText}"
            />
            <button id="clearBtn" title="Clear" aria-label="Clear">
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>
          <div id="count"></div>
        </div>
        <div id="results"></div>
      </ha-card>
    `;

    const input = this.shadowRoot.getElementById("searchInput");
    const clearBtn = this.shadowRoot.getElementById("clearBtn");

    input.addEventListener("input", (e) => {
      this._searchValue = e.target.value;
      clearBtn.classList.toggle("visible", this._searchValue.length > 0);
      this._debouncedSearch(this._searchValue);
    });

    clearBtn.addEventListener("click", () => {
      this._searchValue = "";
      input.value = "";
      clearBtn.classList.remove("visible");
      this._results = [];
      this._activeActions = [];
      this._renderResults();
      input.focus();
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
    if (results.length === 0 && this._activeActions.length === 0) return;

    // Maak een kaart-wrapper voor de resultaten
    const card = document.createElement("div");
    card.className = "results-card";
    resultsContainer.appendChild(card);

    for (const [action, matches] of this._activeActions) {
      card.appendChild(this._createActionRow(action, matches));
    }

    for (const entity_id of results) {
      card.appendChild(this._createEntityRow(entity_id));
    }
  }

  _createEntityRow(entity_id) {
    const state = this._hass?.states[entity_id];
    const friendlyName = state?.attributes?.friendly_name || entity_id;

    const row = document.createElement("div");
    row.className = "entity-row";

    const badge = document.createElement("state-badge");
    badge.dataset.entity = entity_id;
    badge.stateObj = state;
    badge.hass = this._hass;

    const info = document.createElement("div");
    info.className = "entity-info";
    info.textContent = friendlyName;

    const stateEl = document.createElement("div");
    stateEl.className = "entity-state";
    stateEl.dataset.entity = entity_id;
    stateEl.textContent = this._formatState(state);

    row.appendChild(badge);
    row.appendChild(info);
    row.appendChild(stateEl);
    row.addEventListener("click", () => this._fireMoreInfo(entity_id));

    return row;
  }

  _formatState(state) {
    if (!state) return "";
    const unit = state.attributes?.unit_of_measurement;
    return unit ? `${state.state} ${unit}` : state.state;
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
        if (matches != null) active.push([action, matches]);
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
