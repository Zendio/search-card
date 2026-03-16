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
    // Update hass on all entity rows
    this.shadowRoot.querySelectorAll("hui-generic-entity-row, hui-entity-row, state-card-content").forEach((row) => {
      row.hass = hass;
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
        ha-card {
          padding: 8px 0 16px 0;
        }
        #searchContainer {
          width: 90%;
          display: block;
          margin: 0 auto;
        }
        #searchTextFieldContainer {
          display: flex;
          align-items: center;
          padding: 5px 0;
          gap: 8px;
        }
        #searchText {
          flex-grow: 1;
        }
        #clearBtn {
          cursor: pointer;
          color: var(--secondary-text-color);
          background: none;
          border: none;
          padding: 4px;
          display: flex;
          align-items: center;
        }
        #clearBtn:hover {
          color: var(--primary-text-color);
        }
        #count {
          text-align: right;
          font-style: italic;
          font-size: 0.85em;
          color: var(--secondary-text-color);
          padding: 2px 0 4px 0;
        }
        #results {
          width: 90%;
          display: block;
          padding-bottom: 8px;
          margin: 8px auto 0 auto;
        }
        .entity-row {
          display: flex;
          align-items: center;
          padding: 8px 0;
          cursor: pointer;
          border-radius: 4px;
          transition: background-color 0.1s;
        }
        .entity-row:hover {
          background-color: var(--state-color, rgba(var(--rgb-primary-text-color, 0,0,0), 0.04));
        }
        .entity-icon {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 8px;
          flex-shrink: 0;
        }
        .entity-info {
          flex-grow: 1;
          overflow: hidden;
        }
        .entity-name {
          font-size: 1em;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .entity-id {
          font-size: 0.8em;
          color: var(--secondary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .entity-state {
          font-size: 0.9em;
          color: var(--secondary-text-color);
          white-space: nowrap;
          margin-left: 8px;
          flex-shrink: 0;
        }
        .action-row {
          display: flex;
          align-items: center;
          padding: 8px 0;
          cursor: pointer;
          border-radius: 4px;
        }
        .action-row:hover {
          background-color: rgba(var(--rgb-primary-text-color, 0,0,0), 0.04);
        }
        .action-icon {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-right: 8px;
          flex-shrink: 0;
        }
        .action-name {
          font-size: 1em;
          color: var(--primary-text-color);
        }
        ha-textfield {
          width: 100%;
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
            <button id="clearBtn" title="Clear">
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>
          <div id="count"></div>
        </div>
        <div id="results"></div>
      </ha-card>
    `;

    const input = this.shadowRoot.getElementById("searchText");
    input.addEventListener("input", (e) => {
      this._searchValue = e.target.value;
      this._debouncedSearch(this._searchValue);
    });

    const clearBtn = this.shadowRoot.getElementById("clearBtn");
    clearBtn.addEventListener("click", () => {
      this._searchValue = "";
      input.value = "";
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

    if (results.length > 0) {
      countContainer.textContent = `Showing ${results.length} of ${this._results.length} results`;
    } else {
      countContainer.textContent = "";
    }

    resultsContainer.innerHTML = "";

    // Render action rows
    for (const [action, matches] of this._activeActions) {
      const row = this._createActionRow(action, matches);
      resultsContainer.appendChild(row);
    }

    // Render entity rows
    for (const entity_id of results) {
      const row = this._createEntityRow(entity_id);
      resultsContainer.appendChild(row);
    }
  }

  _createEntityRow(entity_id) {
    const state = this._hass?.states[entity_id];
    const friendlyName = state?.attributes?.friendly_name || entity_id;
    const stateValue = state?.state || "";
    const domain = entity_id.split(".")[0];

    const row = document.createElement("div");
    row.className = "entity-row";

    const iconEl = document.createElement("div");
    iconEl.className = "entity-icon";
    const haIcon = document.createElement("ha-state-icon");
    haIcon.stateObj = state;
    haIcon.hass = this._hass;
    iconEl.appendChild(haIcon);

    const info = document.createElement("div");
    info.className = "entity-info";
    info.innerHTML = `
      <div class="entity-name">${friendlyName}</div>
      <div class="entity-id">${entity_id}</div>
    `;

    const stateEl = document.createElement("div");
    stateEl.className = "entity-state";
    stateEl.textContent = stateValue;

    row.appendChild(iconEl);
    row.appendChild(info);
    row.appendChild(stateEl);

    row.addEventListener("click", () => {
      this._fireMoreInfo(entity_id);
    });

    return row;
  }

  _createActionRow(action, matches) {
    const row = document.createElement("div");
    row.className = "action-row";

    const iconEl = document.createElement("div");
    iconEl.className = "action-icon";
    const haIcon = document.createElement("ha-icon");
    haIcon.setAttribute("icon", action.icon || "mdi:lamp");
    iconEl.appendChild(haIcon);

    const name = document.createElement("div");
    name.className = "action-name";
    name.textContent = matchAndReplace(action.name, matches);

    row.appendChild(iconEl);
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
    const event = new CustomEvent("hass-more-info", {
      composed: true,
      bubbles: true,
      detail: { entityId },
    });
    this.dispatchEvent(event);
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
