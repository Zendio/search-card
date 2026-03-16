const BUILTIN_ACTIONS = [
  {
    matches: "^((magnet:.*)|(.*.torrent.*))$",
    name: "Add to Transmission",
    icon: "mdi:progress-download",
    service: "transmission.add_torrent",
    service_data: { torrent: "{1}" },
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
    this._debouncedSearch = this._debounce((v) => this._performSearch(v), 100);
  }

  set hass(hass) {
    this._hass = hass;
    this.shadowRoot.querySelectorAll("state-badge").forEach((badge) => {
      const id = badge.dataset.entity;
      if (id && hass.states[id]) { badge.stateObj = hass.states[id]; badge.hass = hass; }
    });
    this.shadowRoot.querySelectorAll(".entity-state").forEach((el) => {
      const id = el.dataset.entity;
      if (id && hass.states[id]) el.textContent = this._formatState(hass.states[id]);
    });
  }

  setConfig(config) {
    this._config = config;
    this._maxResults = config.max_results || 10;
    this._searchPlaceholder = config.search_text || "Search entities…";
    this._actions = BUILTIN_ACTIONS.concat(config.actions || []);
    this._includedDomains = config.included_domains;
    this._excludedDomains = config.excluded_domains || [];
    this._render();
  }

  getCardSize() { return 4; }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }

        /* Transparante ha-card wrapper */
        ha-card {
          background: transparent !important;
          box-shadow: none !important;
          border: none !important;
        }

        /* ── Eén kaart die groeit als er resultaten zijn ── */
        #card {
          background: var(--card-background-color, #fff);
          border-radius: 12px;
          border: 1px solid rgba(0, 0, 0, 0.12);
          overflow: hidden;
        }

        /* ── Zoekbalk ── */
        #searchWrap {
          display: flex;
          align-items: center;
          height: 56px;
          padding: 0 8px 0 16px;
          box-sizing: border-box;
        }

        /* Scheidingslijn tussen zoekbalk en resultaten */
        #card.has-results #searchWrap {
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }

        #searchIcon {
          flex-shrink: 0;
          color: var(--secondary-text-color, rgba(0,0,0,0.54));
          --mdc-icon-size: 20px;
          display: flex;
          align-items: center;
          margin-right: 12px;
        }

        #searchInput {
          flex: 1;
          border: none;
          outline: none;
          background: transparent;
          font-family: inherit;
          font-size: 16px;
          color: var(--primary-text-color, rgba(0,0,0,0.87));
          caret-color: var(--mdc-theme-primary, #009ac7);
          min-width: 0;
        }

        #searchInput::placeholder {
          color: var(--secondary-text-color, rgba(0,0,0,0.54));
        }

        #clearBtn {
          flex-shrink: 0;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.15s ease;
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
          color: var(--secondary-text-color, rgba(0,0,0,0.54));
          --mdc-icon-size: 18px;
        }

        #clearBtn.visible {
          opacity: 1;
          pointer-events: auto;
        }

        #clearBtn:hover {
          background: rgba(0, 0, 0, 0.06);
        }

        /* ── Resultaten ── */
        #resultsWrap {
          display: none;
          padding: 8px 16px 8px 16px;
        }

        #resultsWrap.visible {
          display: block;
        }

        #count {
          text-align: right;
          font-style: italic;
          font-size: 12px;
          color: var(--secondary-text-color);
          padding: 0 0 4px 0;
        }

        /* ── Entity row: exacte native HA maten ── */
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
          background-color: rgba(0, 0, 0, 0.05);
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
          background-color: rgba(0, 0, 0, 0.05);
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
        <div id="card">
          <div id="searchWrap">
            <span id="searchIcon"><ha-icon icon="mdi:magnify"></ha-icon></span>
            <input
              id="searchInput"
              type="text"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="${this._searchPlaceholder}"
            />
            <button id="clearBtn" title="Clear" aria-label="Clear">
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>
          <div id="resultsWrap">
            <div id="count"></div>
            <div id="rows"></div>
          </div>
        </div>
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
    const card = this.shadowRoot.getElementById("card");
    const resultsWrap = this.shadowRoot.getElementById("resultsWrap");
    const countEl = this.shadowRoot.getElementById("count");
    const rowsEl = this.shadowRoot.getElementById("rows");
    if (!resultsWrap) return;

    const results = this._results.slice(0, this._maxResults).sort();
    const hasContent = results.length > 0 || this._activeActions.length > 0;

    resultsWrap.classList.toggle("visible", hasContent);
    card.classList.toggle("has-results", hasContent);
    rowsEl.innerHTML = "";

    if (!hasContent) { countEl.textContent = ""; return; }

    countEl.textContent = `Showing ${results.length} of ${this._results.length} results`;

    for (const [action, matches] of this._activeActions) {
      rowsEl.appendChild(this._createActionRow(action, matches));
    }
    for (const entity_id of results) {
      rowsEl.appendChild(this._createEntityRow(entity_id));
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
      composed: true, bubbles: true, detail: { entityId },
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
        ) newResults.push(entity_id);
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
    const s = this._hass?.services[domain];
    return s && service in s;
  }

  _debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
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
