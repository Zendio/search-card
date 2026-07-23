class SearchCard extends HTMLElement {
  constructor() {
    super();
    this._results = [];
    this._searchValue = "";
    this._hass = null;
    this._config = null;
    this.attachShadow({ mode: "open" });
    this._debouncedSearch = this._debounce((v) => this._performSearch(v), 100);
  }

  set hass(hass) {
    const previousHass = this._hass;
    this._hass = hass;

    if (
      this._searchValue &&
      this._config &&
      this._searchInputsChanged(previousHass, hass)
    ) {
      this._performSearch(this._searchValue);
      return;
    }

    this.shadowRoot.querySelectorAll(".entity-row").forEach((row) => {
      const id = row.dataset.entity;
      const state = hass.states[id];
      if (!id || !state) return;

      const formattedState = this._formatState(state);
      const badge = row.firstElementChild;
      const stateEl = row.lastElementChild;

      badge.stateObj = state;
      badge.hass = hass;
      stateEl.textContent = formattedState;
      row.setAttribute(
        "aria-label",
        `${this._getEntityName(state, id)}: ${formattedState}`,
      );
    });
  }

  setConfig(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("Search Card configuration must be an object");
    }
    if (
      config.max_results !== undefined &&
      (!Number.isInteger(config.max_results) || config.max_results < 0)
    ) {
      throw new Error("max_results must be a non-negative integer");
    }
    if (
      config.search_text !== undefined &&
      typeof config.search_text !== "string"
    ) {
      throw new Error("search_text must be a string");
    }

    this._validateDomains(config.included_domains, "included_domains");
    this._validateDomains(config.excluded_domains, "excluded_domains");

    this._config = config;
    this._maxResults = config.max_results ?? 10;
    this._searchPlaceholder = config.search_text ?? "Search entities…";
    this._includedDomains = config.included_domains
      ? new Set(config.included_domains)
      : null;
    this._excludedDomains = new Set(config.excluded_domains || []);
    this._render();
    if (this._hass && this._searchValue) {
      this._performSearch(this._searchValue);
    }
  }

  getCardSize() {
    const entityRows = Math.min(this._results.length, this._maxResults || 0);
    const height = 56 + (entityRows > 0 ? 34 + entityRows * 40 : 0);
    return Math.max(1, Math.ceil(height / 50));
  }

  disconnectedCallback() {
    this._debouncedSearch.cancel();
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }

        /*
         * Gebruik ha-card als de echte kaart shell — dan erft het automatisch
         * alle theme variabelen: --ha-card-background, --ha-card-border-radius,
         * --ha-card-border-color, --ha-card-border-width, --ha-card-box-shadow.
         * Themes die deze variabelen zetten (bijv. Mushroom, Google Home)
         * worden zo automatisch correct overgenomen.
         */
        ha-card {
          overflow: hidden;
          /* Geen extra overrides — laat het theme zijn gang gaan */
        }

        /* ── Zoekbalk ── */
        #searchWrap {
          display: flex;
          align-items: center;
          height: 56px;
          padding: 0 8px 0 16px;
          box-sizing: border-box;
        }

        /* Scheidingslijn tussen zoekbalk en resultaten — gebruikt theme divider kleur */
        #card.has-results #searchWrap {
          border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        }

        #searchIcon {
          flex-shrink: 0;
          color: var(--secondary-text-color);
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
          color: var(--primary-text-color);
          caret-color: var(--mdc-theme-primary);
          min-width: 0;
        }

        #searchInput::placeholder {
          color: var(--secondary-text-color);
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
          color: var(--secondary-text-color);
          --mdc-icon-size: 18px;
        }

        #clearBtn.visible {
          opacity: 1;
          pointer-events: auto;
        }

        #clearBtn:hover {
          background-color: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.06);
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
          width: calc(100% + 16px);
          height: 40px;
          cursor: pointer;
          appearance: none;
          box-sizing: border-box;
          border: none;
          border-radius: calc(var(--ha-card-border-radius, 12px) / 2);
          background: transparent;
          color: inherit;
          font: inherit;
          text-align: left;
          transition: background-color 0.12s ease;
          margin: 0 -8px;
          padding: 0 8px;
        }

        .entity-row:hover {
          background-color: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.05);
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

        .entity-row:focus-visible,
        #clearBtn:focus-visible {
          outline: 2px solid var(--primary-color, var(--mdc-theme-primary));
          outline-offset: -2px;
        }
      </style>

      <ha-card id="card">
        <div id="searchWrap">
          <span id="searchIcon"><ha-icon icon="mdi:magnify"></ha-icon></span>
          <input
            id="searchInput"
            type="text"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
          />
          <button id="clearBtn" type="button" title="Clear search" aria-label="Clear search">
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </div>
        <div id="resultsWrap">
          <div id="count" aria-live="polite"></div>
          <div id="rows"></div>
        </div>
      </ha-card>
    `;

    const input = this.shadowRoot.getElementById("searchInput");
    const clearBtn = this.shadowRoot.getElementById("clearBtn");
    const updateClearButton = (visible) => {
      clearBtn.classList.toggle("visible", visible);
      clearBtn.tabIndex = visible ? 0 : -1;
      clearBtn.setAttribute("aria-hidden", String(!visible));
    };
    input.placeholder = this._searchPlaceholder;
    input.setAttribute(
      "aria-label",
      this._searchPlaceholder || "Search entities",
    );
    input.value = this._searchValue;
    updateClearButton(this._searchValue.length > 0);

    input.addEventListener("input", (e) => {
      this._searchValue = e.target.value;
      updateClearButton(this._searchValue.length > 0);
      this._debouncedSearch(this._searchValue);
    });

    clearBtn.addEventListener("click", () => {
      this._debouncedSearch.cancel();
      this._searchValue = "";
      input.value = "";
      updateClearButton(false);
      this._results = [];
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

    const collator = new Intl.Collator(this._hass?.locale?.language, {
      sensitivity: "base",
      numeric: true,
    });
    const results = [...this._results]
      .sort((left, right) => {
        const leftDomain = left.split(".", 1)[0];
        const rightDomain = right.split(".", 1)[0];
        const domainDifference = collator.compare(leftDomain, rightDomain);
        if (domainDifference !== 0) return domainDifference;

        const leftName = this._getEntityName(this._hass?.states[left], left);
        const rightName = this._getEntityName(this._hass?.states[right], right);
        return (
          collator.compare(leftName, rightName) ||
          collator.compare(left, right)
        );
      })
      .slice(0, this._maxResults);
    const hasContent = results.length > 0;

    resultsWrap.classList.toggle("visible", hasContent);
    card.classList.toggle("has-results", hasContent);
    rowsEl.innerHTML = "";

    if (!hasContent) { countEl.textContent = ""; return; }

    countEl.textContent =
      this._results.length > 0
        ? `Showing ${results.length} of ${this._results.length} results`
        : "";

    for (const entity_id of results) {
      rowsEl.appendChild(this._createEntityRow(entity_id));
    }
  }

  _createEntityRow(entity_id) {
    const state = this._hass?.states[entity_id];
    const friendlyName = this._getEntityName(state, entity_id);
    const formattedState = this._formatState(state);

    const row = document.createElement("button");
    row.className = "entity-row";
    row.type = "button";
    row.dataset.entity = entity_id;
    row.setAttribute(
      "aria-label",
      `${friendlyName}: ${formattedState}`,
    );

    const badge = document.createElement("state-badge");
    badge.stateObj = state;
    badge.hass = this._hass;

    const info = document.createElement("div");
    info.className = "entity-info";
    info.textContent = friendlyName;

    const stateEl = document.createElement("div");
    stateEl.className = "entity-state";
    stateEl.textContent = formattedState;

    row.appendChild(badge);
    row.appendChild(info);
    row.appendChild(stateEl);
    row.addEventListener("click", () => this._fireMoreInfo(entity_id));
    return row;
  }

  _formatState(state) {
    if (!state) return "";
    if (typeof this._hass?.formatEntityState === "function") {
      try {
        return this._hass.formatEntityState(state);
      } catch (err) {
        console.warn("Search Card could not format an entity state", err);
      }
    }
    const unit = state.attributes?.unit_of_measurement;
    return unit ? `${state.state} ${unit}` : state.state;
  }

  _getEntityName(state, entityId) {
    return state?.attributes?.friendly_name || entityId;
  }

  _fireMoreInfo(entityId) {
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      composed: true, bubbles: true, detail: { entityId },
    }));
  }

  _performSearch(searchText) {
    const normalizedSearch = searchText.trim().toLocaleLowerCase();
    if (!this._config || !this._hass || normalizedSearch === "") {
      this._results = [];
      this._renderResults();
      return;
    }

    const newResults = [];
    for (const entityId of Object.keys(this._hass.states)) {
      const domain = entityId.split(".", 1)[0];
      if (!this._domainAllowed(domain)) continue;

      const state = this._hass.states[entityId];
      const friendlyName = this._getEntityName(state, entityId);
      if (
        entityId.toLocaleLowerCase().includes(normalizedSearch) ||
        friendlyName.toLocaleLowerCase().includes(normalizedSearch)
      ) {
        newResults.push(entityId);
      }
    }
    this._results = newResults;
    this._renderResults();
  }

  _domainAllowed(domain) {
    return (
      (!this._includedDomains || this._includedDomains.has(domain)) &&
      !this._excludedDomains.has(domain)
    );
  }

  _validateDomains(domains, optionName) {
    if (
      domains !== undefined &&
      (!Array.isArray(domains) ||
        domains.some((domain) => typeof domain !== "string" || domain === ""))
    ) {
      throw new Error(`${optionName} must be an array of domain names`);
    }
  }

  _searchInputsChanged(previousHass, hass) {
    if (!previousHass) return true;
    if (previousHass.locale !== hass.locale) return true;

    const previousStates = previousHass.states || {};
    const states = hass.states || {};
    const previousIds = Object.keys(previousStates);
    const ids = Object.keys(states);
    if (previousIds.length !== ids.length) return true;

    for (const entityId of ids) {
      const previousState = previousStates[entityId];
      const state = states[entityId];
      if (!previousState) return true;
      if (
        previousState !== state &&
        previousState.attributes?.friendly_name !==
          state.attributes?.friendly_name
      ) {
        return true;
      }
    }
    return false;
  }

  _debounce(func, wait) {
    let timeout;
    const debounced = (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
    debounced.cancel = () => {
      clearTimeout(timeout);
      timeout = undefined;
    };
    return debounced;
  }
}

if (!customElements.get("search-card")) {
  customElements.define("search-card", SearchCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "search-card")) {
  window.customCards.push({
    type: "search-card",
    name: "Search Card",
    preview: true,
    description: "Card to search entities",
  });
}
