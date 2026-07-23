const TRANSLATIONS = {
  en: {
    search_entities: "Search entities…",
    clear_search: "Clear search",
    showing_results: "Showing {shown} of {total} results",
    no_results: "No entities found",
  },
  nl: {
    search_entities: "Entiteiten zoeken…",
    clear_search: "Zoekopdracht wissen",
    showing_results: "{shown} van {total} resultaten",
    no_results: "Geen entiteiten gevonden",
  },
};

const COMMON_DOMAINS = [
  "automation",
  "binary_sensor",
  "camera",
  "climate",
  "cover",
  "fan",
  "light",
  "lock",
  "media_player",
  "person",
  "scene",
  "script",
  "sensor",
  "switch",
  "vacuum",
];

class SearchCard extends HTMLElement {
  static getConfigForm() {
    const domainOptions = COMMON_DOMAINS.map((domain) => ({
      label: domain,
      value: domain,
    }));

    return {
      schema: [
        {
          name: "max_results",
          selector: { number: { min: 0, mode: "box" } },
        },
        { name: "search_text", selector: { text: {} } },
        {
          name: "secondary_info",
          selector: {
            select: {
              options: [
                { label: "Entity ID", value: "entity_id" },
                { label: "Device", value: "device" },
                { label: "Area", value: "area" },
                { label: "Area · Device", value: "area_device" },
                { label: "None", value: "none" },
              ],
            },
          },
        },
        {
          name: "included_domains",
          selector: {
            select: {
              multiple: true,
              custom_value: true,
              options: domainOptions,
            },
          },
        },
        {
          name: "excluded_domains",
          selector: {
            select: {
              multiple: true,
              custom_value: true,
              options: domainOptions,
            },
          },
        },
        {
          name: "included_entities",
          selector: { entity: { multiple: true } },
        },
        {
          name: "excluded_entities",
          selector: { entity: { multiple: true } },
        },
        {
          name: "hide_unavailable",
          selector: { boolean: {} },
        },
      ],
      computeLabel: (schema) =>
        ({
          max_results: "Maximum results",
          search_text: "Search placeholder",
          secondary_info: "Secondary information",
          included_domains: "Included domains",
          excluded_domains: "Excluded domains",
          included_entities: "Included entities",
          excluded_entities: "Excluded entities",
          hide_unavailable: "Hide unavailable entities",
        })[schema.name] || schema.name,
    };
  }

  static getStubConfig() {
    return {
      max_results: 10,
      secondary_info: "entity_id",
    };
  }

  constructor() {
    super();
    this._results = [];
    this._resultScores = new Map();
    this._searchValue = "";
    this._hass = null;
    this._config = null;
    this.attachShadow({ mode: "open" });
    this._debouncedSearch = this._debounce((v) => this._performSearch(v), 100);
  }

  set hass(hass) {
    const previousHass = this._hass;
    this._hass = hass;
    this._updateLocalizedControls();

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
        [
          this._getEntityName(state, id),
          this._getSecondaryInfo(state, id),
          formattedState,
        ]
          .filter(Boolean)
          .join(", "),
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
    this._validateEntities(config.included_entities, "included_entities");
    this._validateEntities(config.excluded_entities, "excluded_entities");

    const secondaryOptions = [
      "none",
      "entity_id",
      "device",
      "area",
      "area_device",
    ];
    if (
      config.secondary_info !== undefined &&
      !secondaryOptions.includes(config.secondary_info)
    ) {
      throw new Error(
        `secondary_info must be one of: ${secondaryOptions.join(", ")}`,
      );
    }
    if (
      config.hide_unavailable !== undefined &&
      typeof config.hide_unavailable !== "boolean"
    ) {
      throw new Error("hide_unavailable must be a boolean");
    }

    this._config = config;
    this._maxResults = config.max_results ?? 10;
    this._searchPlaceholder = config.search_text;
    this._secondaryInfo = config.secondary_info ?? "entity_id";
    this._hideUnavailable = config.hide_unavailable ?? false;
    this._includedDomains = config.included_domains
      ? new Set(config.included_domains)
      : null;
    this._excludedDomains = new Set(config.excluded_domains || []);
    this._includedEntities =
      config.included_entities !== undefined
        ? new Set(config.included_entities)
        : null;
    this._excludedEntities = new Set(config.excluded_entities || []);
    this._render();
    if (this._hass && this._searchValue) {
      this._performSearch(this._searchValue);
    }
  }

  getCardSize() {
    const entityRows = Math.min(this._results.length, this._maxResults || 0);
    const rowHeight = this._secondaryInfo === "none" ? 40 : 56;
    const hasQuery = this._searchValue.trim().length > 0;
    const height = 56 + (hasQuery ? 34 + entityRows * rowHeight : 0);
    return Math.max(1, Math.ceil(height / 50));
  }

  getGridOptions() {
    return {
      columns: 12,
      min_columns: 6,
    };
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

        #count.no-results {
          text-align: center;
          padding: 8px 0;
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

        .entity-row.has-secondary {
          height: 56px;
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
          overflow: hidden;
          color: var(--primary-text-color);
        }

        .entity-primary,
        .entity-secondary {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .entity-primary {
          font-size: 14px;
          line-height: 20px;
        }

        .entity-secondary {
          font-size: 12px;
          line-height: 16px;
          color: var(--secondary-text-color);
        }

        mark {
          padding: 0;
          border-radius: 2px;
          background: color-mix(
            in srgb,
            var(--primary-color, var(--mdc-theme-primary)) 24%,
            transparent
          );
          color: inherit;
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
          <button id="clearBtn" type="button">
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
    const rowsEl = this.shadowRoot.getElementById("rows");
    const updateClearButton = (visible) => {
      clearBtn.classList.toggle("visible", visible);
      clearBtn.tabIndex = visible ? 0 : -1;
      clearBtn.setAttribute("aria-hidden", String(!visible));
    };
    const clearSearch = () => {
      this._debouncedSearch.cancel();
      this._searchValue = "";
      this._results = [];
      this._resultScores.clear();
      input.value = "";
      updateClearButton(false);
      this._renderResults();
    };
    const getRows = () => Array.from(rowsEl.querySelectorAll(".entity-row"));
    const focusRow = (index) => {
      const rows = getRows();
      if (rows.length === 0) return;
      rows[Math.max(0, Math.min(index, rows.length - 1))].focus();
    };

    this._updateLocalizedControls();
    input.value = this._searchValue;
    updateClearButton(this._searchValue.length > 0);

    input.addEventListener("input", (e) => {
      this._searchValue = e.target.value;
      updateClearButton(this._searchValue.length > 0);
      this._debouncedSearch(this._searchValue);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusRow(0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const rows = getRows();
        focusRow(rows.length - 1);
      } else if (event.key === "Enter") {
        const [firstRow] = getRows();
        if (firstRow) {
          event.preventDefault();
          firstRow.click();
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        clearSearch();
      }
    });

    rowsEl.addEventListener("keydown", (event) => {
      const row = event.target.closest(".entity-row");
      if (!row) return;
      const rows = getRows();
      const index = rows.indexOf(row);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusRow((index + 1) % rows.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (index === 0) input.focus();
        else focusRow(index - 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        clearSearch();
        input.focus();
      } else if (event.key === "/") {
        event.preventDefault();
        input.focus();
      }
    });

    clearBtn.addEventListener("click", () => {
      clearSearch();
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
        const scoreDifference =
          (this._resultScores.get(left) ?? 99) -
          (this._resultScores.get(right) ?? 99);
        if (scoreDifference !== 0) return scoreDifference;

        const leftName = this._getEntityName(this._hass?.states[left], left);
        const rightName = this._getEntityName(this._hass?.states[right], right);
        return (
          collator.compare(leftName, rightName) ||
          collator.compare(left, right)
        );
      })
      .slice(0, this._maxResults);
    const hasQuery = this._searchValue.trim().length > 0;

    resultsWrap.classList.toggle("visible", hasQuery);
    card.classList.toggle("has-results", hasQuery);
    rowsEl.replaceChildren();

    if (!hasQuery) {
      countEl.textContent = "";
      countEl.classList.remove("no-results");
      return;
    }

    if (this._results.length === 0) {
      countEl.textContent = this._translate("no_results");
      countEl.classList.add("no-results");
      return;
    }

    countEl.classList.remove("no-results");
    countEl.textContent = this._translate("showing_results", {
      shown: results.length,
      total: this._results.length,
    });

    for (const entityId of results) {
      rowsEl.appendChild(this._createEntityRow(entityId));
    }
  }

  _createEntityRow(entityId) {
    const state = this._hass?.states[entityId];
    const friendlyName = this._getEntityName(state, entityId);
    const secondaryInfo = this._getSecondaryInfo(state, entityId);
    const formattedState = this._formatState(state);

    const row = document.createElement("button");
    row.className = "entity-row";
    row.classList.toggle("has-secondary", Boolean(secondaryInfo));
    row.type = "button";
    row.dataset.entity = entityId;
    row.setAttribute(
      "aria-label",
      [friendlyName, secondaryInfo, formattedState].filter(Boolean).join(", "),
    );

    const badge = document.createElement("state-badge");
    badge.stateObj = state;
    badge.hass = this._hass;

    const info = document.createElement("div");
    info.className = "entity-info";

    const primary = document.createElement("div");
    primary.className = "entity-primary";
    this._appendHighlightedText(primary, friendlyName);
    info.appendChild(primary);

    if (secondaryInfo) {
      const secondary = document.createElement("div");
      secondary.className = "entity-secondary";
      this._appendHighlightedText(secondary, secondaryInfo);
      info.appendChild(secondary);
    }

    const stateEl = document.createElement("div");
    stateEl.className = "entity-state";
    stateEl.textContent = formattedState;

    row.appendChild(badge);
    row.appendChild(info);
    row.appendChild(stateEl);
    row.addEventListener("click", () => this._fireMoreInfo(entityId));
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

  _getSecondaryInfo(state, entityId) {
    if (this._secondaryInfo === "none") return "";
    if (this._secondaryInfo === "entity_id") return entityId;
    if (!state || typeof this._hass?.formatEntityName !== "function") return "";

    const nameParts = {
      device: { type: "device" },
      area: { type: "area" },
      area_device: [{ type: "area" }, { type: "device" }],
    }[this._secondaryInfo];
    if (!nameParts) return "";

    try {
      const formatted = this._hass.formatEntityName(state, nameParts, {
        separator: " · ",
      });
      return formatted === this._getEntityName(state, entityId)
        ? ""
        : formatted || "";
    } catch (err) {
      console.warn("Search Card could not format secondary information", err);
      return "";
    }
  }

  _appendHighlightedText(container, text) {
    const tokens = this._searchValue
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    if (tokens.length === 0) {
      container.textContent = text;
      return;
    }

    const escapedTokens = tokens.map((token) =>
      token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    const pattern = new RegExp(`(${escapedTokens.join("|")})`, "gi");
    let lastIndex = 0;

    for (const match of text.matchAll(pattern)) {
      if (match.index > lastIndex) {
        container.appendChild(
          document.createTextNode(text.slice(lastIndex, match.index)),
        );
      }
      const mark = document.createElement("mark");
      mark.textContent = match[0];
      container.appendChild(mark);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  _fireMoreInfo(entityId) {
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      composed: true, bubbles: true, detail: { entityId },
    }));
  }

  _performSearch(searchText) {
    const normalizedSearch = this._normalizeText(searchText.trim());
    const tokens = normalizedSearch.split(/\s+/).filter(Boolean);
    if (!this._config || !this._hass || tokens.length === 0) {
      this._results = [];
      this._resultScores.clear();
      this._renderResults();
      return;
    }

    const newResults = [];
    const newScores = new Map();
    for (const entityId of Object.keys(this._hass.states)) {
      const domain = entityId.split(".", 1)[0];
      const state = this._hass.states[entityId];
      if (!this._entityAllowed(entityId, domain, state)) continue;

      const friendlyName = this._getEntityName(state, entityId);
      const secondaryInfo = this._getSecondaryInfo(state, entityId);
      const normalizedId = this._normalizeText(entityId);
      const normalizedName = this._normalizeText(friendlyName);
      const normalizedSecondary = this._normalizeText(secondaryInfo);
      const haystack = `${normalizedName} ${normalizedId} ${normalizedSecondary}`;
      if (!tokens.every((token) => haystack.includes(token))) continue;

      let score = 5;
      if (normalizedName === normalizedSearch) score = 0;
      else if (normalizedId === normalizedSearch) score = 1;
      else if (normalizedName.startsWith(normalizedSearch)) score = 2;
      else if (normalizedId.startsWith(normalizedSearch)) score = 3;
      else {
        const words = normalizedName.split(/\s+/);
        if (tokens.every((token) => words.some((word) => word.startsWith(token)))) {
          score = 4;
        }
      }

      newResults.push(entityId);
      newScores.set(entityId, score);
    }
    this._results = newResults;
    this._resultScores = newScores;
    this._renderResults();
  }

  _normalizeText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
  }

  _entityAllowed(entityId, domain, state) {
    return (
      (!this._includedDomains || this._includedDomains.has(domain)) &&
      !this._excludedDomains.has(domain) &&
      (!this._includedEntities || this._includedEntities.has(entityId)) &&
      !this._excludedEntities.has(entityId) &&
      (!this._hideUnavailable || state?.state !== "unavailable")
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

  _validateEntities(entities, optionName) {
    if (
      entities !== undefined &&
      (!Array.isArray(entities) ||
        entities.some(
          (entityId) =>
            typeof entityId !== "string" ||
            !/^[a-z0-9_]+\.[a-z0-9_]+$/i.test(entityId),
        ))
    ) {
      throw new Error(`${optionName} must be an array of entity IDs`);
    }
  }

  _translate(key, variables = {}) {
    const language = this._hass?.locale?.language?.split("-")[0] || "en";
    let value =
      TRANSLATIONS[language]?.[key] ||
      TRANSLATIONS.en[key] ||
      key;
    for (const [name, replacement] of Object.entries(variables)) {
      value = value.replace(`{${name}}`, replacement);
    }
    return value;
  }

  _updateLocalizedControls() {
    const input = this.shadowRoot.getElementById("searchInput");
    const clearBtn = this.shadowRoot.getElementById("clearBtn");
    if (!input || !clearBtn) return;

    const placeholder =
      this._searchPlaceholder ?? this._translate("search_entities");
    const clearLabel = this._translate("clear_search");
    input.placeholder = placeholder;
    input.setAttribute("aria-label", placeholder);
    clearBtn.title = clearLabel;
    clearBtn.setAttribute("aria-label", clearLabel);
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
        (previousState.attributes?.friendly_name !==
          state.attributes?.friendly_name ||
          (this._hideUnavailable &&
            (previousState.state === "unavailable") !==
              (state.state === "unavailable")))
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
