# Search Card

A lightweight Lovelace card for Home Assistant that lets you quickly find
entities and open their more-info dialogs.

## Features

- 🔍 Case-insensitive, literal search by entity ID or friendly name
- 🎯 Optional domain filtering with include and exclude lists
- 📋 Configurable result limit and search placeholder
- 🔤 Locale-aware sorting by friendly name
- 🏷️ Native Home Assistant entity badges and localized state formatting
- 🔄 Live state updates and automatic handling of added, removed, or renamed
  entities
- ⌨️ Keyboard-accessible result and clear buttons

## Installation

### Prerequisites

- Home Assistant with a Lovelace dashboard

No additional custom cards or `card-tools` installation is required.

### Manual installation

1. Copy `search-card.js` to:

   ```text
   config/www/search-card/search-card.js
   ```

2. Add the JavaScript file as a Lovelace resource:

   ```yaml
   resources:
     - url: /local/search-card/search-card.js?v=1
       type: module
   ```

3. Reload the dashboard. When replacing an existing version, increment the
   `v` query parameter or perform a hard refresh to bypass the browser cache.

## Configuration

### Basic example

```yaml
type: custom:search-card
max_results: 10
search_text: "Search entities..."
excluded_domains:
  - automation
```

### Available options

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `max_results` | integer | `10` | Maximum number of entity results to display. Must be zero or greater. |
| `search_text` | string | `"Search entities…"` | Placeholder and accessible label for the search field. |
| `included_domains` | string[] | all domains | Only include entities from these domains. |
| `excluded_domains` | string[] | none | Exclude entities from these domains. |

`included_domains` and `excluded_domains` may be used together. When both are
configured, an entity must be in the include list and not in the exclude list.

Search text is treated as literal text, not as a regular expression. Leading
and trailing whitespace is ignored.

## Domain filtering

### Include only selected domains

```yaml
type: custom:search-card
included_domains:
  - light
  - switch
```

### Exclude selected domains

```yaml
type: custom:search-card
excluded_domains:
  - automation
  - script
```

### Combine include and exclude filters

```yaml
type: custom:search-card
included_domains:
  - light
  - switch
  - sensor
excluded_domains:
  - sensor
```

This example shows lights and switches. Sensors are explicitly excluded even
though they also appear in `included_domains`.

Common Home Assistant domains include `light`, `switch`, `sensor`,
`binary_sensor`, `climate`, `media_player`, `automation`, `script`, `camera`,
and `cover`.

## Usage

Start typing to search the entity ID and friendly name of every entity allowed
by the configured domain filters. Results are sorted by friendly name and
limited by `max_results`.

Select a result with a pointer or keyboard to open its Home Assistant more-info
dialog. Entity states remain updated while the results are visible.

## Troubleshooting

If the card does not appear or update:

1. Verify that `/local/search-card/search-card.js` loads in the browser.
2. Confirm that the Lovelace resource uses `type: module`.
3. Increment the resource URL version, for example from `?v=1` to `?v=2`.
4. Perform a hard browser refresh.
5. Check the browser console for configuration or JavaScript errors.
6. Verify that domain filters are arrays of domain names.

## Development

The regression tests use the Node.js test runner and have no external
dependencies:

```bash
npm test
```
