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
    this.shadowRoot.querySelectorAll(".entity-row-element").forEach((row) => {
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
          padding-bottom: 8px;
        }
        #searchContainer {
          width: 90%;
          display: block;
          margin: 0 auto;
          padding: 8px 0 4px 0;
        }
        #searchTextFieldContainer {
          display: flex;
          align-items: center;
        }
        ha-textfield {
          flex-grow: 1;
        }
        #clearBtn {
          cursor: pointer;
          color: var(--secondary-text-color);
          background: none;
          border: none;
          padding: 0;
          margin-left: 4px;
          display: flex;
          align-items: center;
        }
        #count {
          text-align: right;
          font-style: italic;
          font-size: 0.85em;
          color: var(--secondary-text-color);
          padding: 2px 0;
        }
        #results {
          width: 90%;
          display: block;
          margin: 4px auto 0 auto;
        }
        .entity-row-wrapper {
          cursor: pointer;
          display: block;
        }
        .entity-row-element {
          display: block;
          pointer-events: none;
        }
        .action-row {
          display: flex;
          align-items: center;
          min-height: 52px;
          padding: 4px 0;
          cursor: pointer;
        }
        .action-row:hover {
          background: rgba(0,0,0,0.04);
          border-radius: 4px;
        }
        .action-icon {
          width: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--paper-item-icon-color, #44739e);
          flex-shrink: 0;
        }
        .action-name {
          font-size: 1em;
          color: var(--primary-text-color);
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
      resultsContainer.appendChild(this._createEntityRowWrapper(entity_id));
    }
  }

  _createEntityRowWrapper(entity_id) {
    const wrapper = document.createElement("div");
    wrapper.className = "entity-row-wrapper";

    const row = document.createElement("hui-generic-entity-row");
    row.className = "entity-row-element";
    row.config = { entity: entity_id };
    row.hass = this._hass;

    wrapper.appendChild(row);
    wrapper.addEventListener("click", () => {
      this._fireMoreInfo(entity_id);
    });

    return wrapper;
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
