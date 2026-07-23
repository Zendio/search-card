const BUILTIN_ACTIONS = [
  {
    matches: "^((magnet:\\?.+)|(.*\\.torrent(?:[?#].*)?))$",
    flags: "i",
    name: "Add to Transmission",
    icon: "mdi:progress-download",
    service: "transmission.add_torrent",
    service_data: { torrent: "{1}" },
  },
];

const matchAndReplace = (value, matches) => {
  if (typeof value === "string") {
    return value.replace(/\{(\d+)\}/g, (placeholder, index) => {
      const replacement = matches[Number(index)];
      return replacement == null ? placeholder : replacement;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => matchAndReplace(item, matches));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        matchAndReplace(item, matches),
      ]),
    );
  }
  return value;
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

    this.shadowRoot.querySelectorAll("state-badge").forEach((badge) => {
      const id = badge.dataset.entity;
      if (id && hass.states[id]) {
        badge.stateObj = hass.states[id];
        badge.hass = hass;
      }
    });
    this.shadowRoot.querySelectorAll(".entity-info").forEach((el) => {
      const id = el.dataset.entity;
      if (id && hass.states[id]) {
        el.textContent = this._getEntityName(hass.states[id], id);
      }
    });
    this.shadowRoot.querySelectorAll(".entity-state").forEach((el) => {
      const id = el.dataset.entity;
      if (id && hass.states[id]) {
        el.textContent = this._formatState(hass.states[id]);
      }
    });
    this.shadowRoot.querySelectorAll(".entity-row").forEach((row) => {
      const id = row.dataset.entity;
      if (id && hass.states[id]) {
        row.setAttribute(
          "aria-label",
          `${this._getEntityName(hass.states[id], id)}: ${this._formatState(hass.states[id])}`,
        );
      }
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

    if (config.actions !== undefined && !Array.isArray(config.actions)) {
      throw new Error("actions must be an array");
    }

    this._config = config;
    this._maxResults = config.max_results ?? 10;
    this._searchPlaceholder = config.search_text ?? "Search entities…";
    this._actions = BUILTIN_ACTIONS.concat(config.actions || []).map(
      (action, index) => this._normalizeAction(action, index),
    );
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
    const rowCount = entityRows + this._activeActions.length;
    const height = 56 + (rowCount > 0 ? 34 + rowCount * 40 : 0);
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

        /* ── Action row ── */
        .action-row {
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

        .action-row:hover {
          background-color: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.05);
        }

        .entity-row:focus-visible,
        .action-row:focus-visible,
        #clearBtn:focus-visible {
          outline: 2px solid var(--primary-color, var(--mdc-theme-primary));
          outline-offset: -2px;
        }

        .action-row:disabled {
          cursor: progress;
          opacity: 0.6;
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

    const collator = new Intl.Collator(this._hass?.locale?.language, {
      sensitivity: "base",
      numeric: true,
    });
    const results = [...this._results]
      .sort((left, right) => {
        const leftName = this._getEntityName(this._hass?.states[left], left);
        const rightName = this._getEntityName(this._hass?.states[right], right);
        return collator.compare(leftName, rightName) || collator.compare(left, right);
      })
      .slice(0, this._maxResults);
    const hasContent = results.length > 0 || this._activeActions.length > 0;

    resultsWrap.classList.toggle("visible", hasContent);
    card.classList.toggle("has-results", hasContent);
    rowsEl.innerHTML = "";

    if (!hasContent) { countEl.textContent = ""; return; }

    countEl.textContent =
      this._results.length > 0
        ? `Showing ${results.length} of ${this._results.length} results`
        : "";

    for (const [action, matches] of this._activeActions) {
      rowsEl.appendChild(this._createActionRow(action, matches));
    }
    for (const entity_id of results) {
      rowsEl.appendChild(this._createEntityRow(entity_id));
    }
  }

  _createEntityRow(entity_id) {
    const state = this._hass?.states[entity_id];
    const friendlyName = this._getEntityName(state, entity_id);

    const row = document.createElement("button");
    row.className = "entity-row";
    row.type = "button";
    row.dataset.entity = entity_id;
    row.setAttribute(
      "aria-label",
      `${friendlyName}: ${this._formatState(state)}`,
    );

    const badge = document.createElement("state-badge");
    badge.dataset.entity = entity_id;
    badge.stateObj = state;
    badge.hass = this._hass;

    const info = document.createElement("div");
    info.className = "entity-info";
    info.dataset.entity = entity_id;
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
    const fallback = state?.attributes?.friendly_name || entityId;
    if (state && typeof this._hass?.formatEntityName === "function") {
      try {
        return this._hass.formatEntityName(state, fallback) || fallback;
      } catch (err) {
        console.warn("Search Card could not format an entity name", err);
      }
    }
    return fallback;
  }

  _createActionRow(action, matches) {
    const row = document.createElement("button");
    row.className = "action-row";
    row.type = "button";

    const iconArea = document.createElement("div");
    iconArea.className = "action-icon";
    const haIcon = document.createElement("ha-icon");
    haIcon.setAttribute("icon", action.icon || "mdi:lamp");
    iconArea.appendChild(haIcon);

    const name = document.createElement("div");
    name.className = "action-name";
    name.textContent = matchAndReplace(action.name, matches);
    row.setAttribute("aria-label", name.textContent);

    row.appendChild(iconArea);
    row.appendChild(name);
    row.addEventListener("click", async () => {
      const serviceData = matchAndReplace(action.service_data, matches);
      const [domain, service] = action.service.split(".");
      row.disabled = true;
      try {
        await this._hass.callService(domain, service, serviceData);
      } catch (err) {
        console.error(
          `Search Card failed to call ${action.service}`,
          err,
        );
      } finally {
        row.disabled = false;
      }
    });
    return row;
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
      this._activeActions = [];
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
    this._activeActions = this._getActivatedActions(searchText.trim());
    this._renderResults();
  }

  _getActivatedActions(searchText) {
    const active = [];
    for (const action of this._actions) {
      if (this._serviceExists(action.service)) {
        action.regex.lastIndex = 0;
        const matches = action.regex.exec(searchText);
        if (matches != null) active.push([action, matches]);
      }
    }
    return active;
  }

  _serviceExists(serviceCall) {
    const [domain, service] = serviceCall.split(".");
    const s = this._hass?.services[domain];
    return Boolean(s && Object.hasOwn(s, service));
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

  _normalizeAction(action, index) {
    const label = `actions[${index}]`;
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      throw new Error(`${label} must be an object`);
    }
    if (typeof action.matches !== "string") {
      throw new Error(`${label}.matches must be a string`);
    }
    if (typeof action.name !== "string" || action.name === "") {
      throw new Error(`${label}.name must be a non-empty string`);
    }
    if (
      typeof action.service !== "string" ||
      !/^[a-z0-9_]+\.[a-z0-9_]+$/i.test(action.service)
    ) {
      throw new Error(`${label}.service must use the domain.service format`);
    }
    if (
      action.service_data !== undefined &&
      (!action.service_data ||
        typeof action.service_data !== "object" ||
        Array.isArray(action.service_data))
    ) {
      throw new Error(`${label}.service_data must be an object`);
    }
    if (action.flags !== undefined && typeof action.flags !== "string") {
      throw new Error(`${label}.flags must be a string`);
    }

    let regex;
    try {
      regex = new RegExp(action.matches, action.flags || "");
    } catch (err) {
      throw new Error(`${label}.matches is not a valid regular expression: ${err.message}`);
    }

    return {
      ...action,
      service_data: action.service_data || {},
      regex,
    };
  }

  _searchInputsChanged(previousHass, hass) {
    if (!previousHass) return true;
    if (previousHass.services !== hass.services) return true;
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
