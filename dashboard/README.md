# Conspire P2P Dashboard

A real-time dashboard for visualizing Conspire P2P statistics and metrics.

## Features

- **Dynamic Data Loading**: Fetches stats data from online JSON endpoints
- **Multiple Data Sources**: Supports remote URLs, local JSON files, CORS proxies, and demo data
- **Real-time Visualizations**: Interactive charts showing peer activity, room usage, communication patterns, and system metrics
- **Responsive Design**: Works on desktop and mobile devices
- **CORS Handling**: Comprehensive solutions for cross-origin request issues
- **Error Handling**: Graceful handling of network errors with retry functionality and helpful solutions
- **Customizable Data Source**: Configurable stats URL via URL parameters

## Usage

### Basic Usage

Open `index.html` in a web browser. The dashboard will automatically fetch data from the default stats endpoint:
```
https://conspire.dyne.org:8443/admin/stats.json
```

### Custom Stats URL

You can specify a custom stats URL using the `statsUrl` parameter:
```
index.html?statsUrl=https://your-conspire-server.com:8443/admin/stats.json
```

### CORS Issues & Solutions

If you encounter CORS (Cross-Origin Resource Sharing) errors when fetching data from a remote server, you have several options:

#### Option 1: Use CORS Proxy
Click the "Try CORS Proxy" button in the error dialog to route requests through a public CORS proxy service.

#### Option 2: Load Local JSON File  
1. Click "Load JSON File" button
2. Select a JSON file from your computer (use `sample-stats.json` for testing)
3. The dashboard will display data from your local file

#### Option 3: Use Sample Data
Click "Load Sample Data" to see the dashboard with demonstration data.

#### Option 4: Server-side Solutions
- **Same Origin**: Host the dashboard on the same server as the stats API
- **CORS Headers**: Configure your server to include CORS headers:
  ```
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, OPTIONS
  Access-Control-Allow-Headers: Content-Type
  ```

#### Option 5: Development Mode (Local Only)
For local development, start Chrome with disabled web security:
```bash
google-chrome --disable-web-security --user-data-dir="/tmp/chrome_dev"
```

### Local Development

Start a local web server in the dashboard directory:
```bash
cd dashboard
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser.

## Data Format

The dashboard expects JSON data in the following format:
```json
[
  {
    "timestamp": 1759175878080771,
    "ev_front_page_loaded": 1,
    "ev_peer_connected": 11,
    "ev_peer_disconnected": 9,
    "ev_peer_zombie_dropped": 5,
    "ev_peer_send_message": 4,
    "ev_peer_share_file": 2,
    "ev_room_created": 6,
    "ev_room_deleted": 4,
    "file_served_bytes": 468185
  }
]
```

## Charts

The dashboard displays four main visualizations:

1. **Peer Activity**: Tracks peer connections, disconnections, and zombie drops
2. **Room Activity**: Shows room creation and deletion patterns
3. **Communication**: Displays message sending and file sharing activity
4. **System Metrics**: Combines front page loads and data served metrics

## Error Handling

- **Network Errors**: Displays error messages with retry functionality
- **Invalid Data**: Validates JSON format and data structure
- **Loading States**: Shows loading indicators during data fetch

## Refresh Functionality

Use the "Refresh Data" button to manually reload the latest statistics, or call `refreshDashboard()` programmatically.

## Browser Compatibility

The dashboard uses modern JavaScript features (async/await, fetch API) and requires:
- Chrome 55+
- Firefox 52+
- Safari 10.1+
- Edge 79+

## Customization

### Colors
Chart colors are defined in the `colors` array in `app.js` and follow the design system.

### Styling
Dashboard styling uses CSS custom properties (variables) defined in `style.css` with support for light/dark mode themes.

### Adding New Metrics
To add new metrics:
1. Ensure the data is present in the JSON response
2. Add new datasets to the appropriate chart configuration
3. Assign colors from the `colors` array