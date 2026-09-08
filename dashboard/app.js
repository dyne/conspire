// Conspire P2P Dashboard Data Configuration
const DEFAULT_STATS_URL = globalThis.ConspireDashboardConfig?.statsUrl ?? '/admin/stats.json';
const MAX_STATS_BYTES = 1024 * 1024;
const MAX_STATS_POINTS = 1000;
const REQUIRED_STAT_FIELDS = ['timestamp', 'ev_peer_connected', 'ev_peer_disconnected'];
const CHART_COLOR_TOKENS = Array.from({ length: 10 }, (_, index) => `--ds-chart-${index + 1}`);
let statsData = [];
let charts = {};

const METRICS = [
    { id: 'peer', canvas: 'peerChart', title: 'Peer Activity', fields: [['Peers Connected', 'ev_peer_connected'], ['Peers Disconnected', 'ev_peer_disconnected'], ['Zombie Dropped', 'ev_peer_zombie_dropped']] },
    { id: 'room', canvas: 'roomChart', title: 'Room Activity', fields: [['Rooms Created', 'ev_room_created'], ['Rooms Deleted', 'ev_room_deleted']] },
    { id: 'communication', canvas: 'communicationChart', title: 'Communication', fields: [['Messages Sent', 'ev_peer_send_message'], ['Files Shared', 'ev_peer_share_file']] },
    { id: 'system', canvas: 'systemChart', title: 'System Metrics', fields: [['Front Page Loads', 'ev_front_page_loaded'], ['Data Served', 'file_served_bytes', 'MB']] }
];

function safeStatsUrl(value) {
    try {
        const url = new URL(value, window.location.origin);
        if (!['https:', 'http:'].includes(url.protocol)) return null;
        if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
        return url.href;
    } catch (_) { return null; }
}

function validStats(data) {
    return Array.isArray(data) && data.length > 0 && data.length <= MAX_STATS_POINTS && data.every(point => point && typeof point === 'object' && REQUIRED_STAT_FIELDS.every(field => Number.isFinite(point[field])));
}

function formatTimestamp(timestamp) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp / 1000));
}

function formatValue(value, unit = '') {
    if (!Number.isFinite(value)) return '—';
    const displayed = unit === 'MB' ? value / 1024 / 1024 : value;
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: unit === 'MB' ? 2 : 0 }).format(displayed)}${unit ? ` ${unit}` : ''}`;
}

function messageNode(tag, text) { const node = document.createElement(tag); node.textContent = text; return node; }
function actionButton(label, handler) { const button = messageNode('button', label); button.type = 'button'; button.className = 'dashboard-status-action'; button.addEventListener('click', handler); return button; }

function setDashboardStatus(kind, message, action = null, focus = false) {
    const status = document.getElementById('dashboard-status');
    status.hidden = false;
    status.className = `dashboard-status dashboard-status--${kind}`;
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    status.replaceChildren(messageNode('p', message));
    if (action) status.append(actionButton(action.label, action.handler));
    if (focus) status.focus();
}

function getChartColors() { const styles = getComputedStyle(document.documentElement); return CHART_COLOR_TOKENS.map(token => styles.getPropertyValue(token).trim()); }
function getStatsUrl() { const params = new URLSearchParams(window.location.search); return safeStatsUrl(params.get('statsUrl') || DEFAULT_STATS_URL) || DEFAULT_STATS_URL; }

function renderSemanticChart(metric) {
    const root = document.getElementById(`${metric.id}-chart-data`);
    const summary = document.getElementById(`${metric.id}-chart-summary`);
    const latest = statsData.at(-1);
    const values = metric.fields.map(([label, field, unit]) => `${label}: ${formatValue(latest?.[field], unit)}`);
    summary.textContent = statsData.length ? `Latest at ${formatTimestamp(latest.timestamp)}. ${values.join('; ')}.` : 'No data is available for this metric.';
    const table = root.querySelector('table');
    const header = document.createElement('tr');
    const timestamp = messageNode('th', 'Timestamp'); timestamp.scope = 'col'; header.append(timestamp);
    metric.fields.forEach(([label, , unit]) => { const cell = messageNode('th', unit ? `${label} (${unit})` : label); cell.scope = 'col'; header.append(cell); });
    table.tHead.replaceChildren(header);
    table.tBodies[0].replaceChildren(...statsData.map(point => {
        const row = document.createElement('tr'); const time = messageNode('th', formatTimestamp(point.timestamp)); time.scope = 'row'; row.append(time);
        metric.fields.forEach(([, field, unit]) => row.append(messageNode('td', formatValue(point[field], unit)))); return row;
    }));
}

function chartOptions() {
    const styles = getComputedStyle(document.documentElement);
    const text = styles.getPropertyValue('--color-text').trim(); const secondary = styles.getPropertyValue('--color-text-secondary').trim();
    return { type: 'line', options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', labels: { color: text, font: { size: 12 } } }, tooltip: { enabled: true, mode: 'index', intersect: false, backgroundColor: styles.getPropertyValue('--color-surface').trim(), titleColor: text, bodyColor: text, borderColor: styles.getPropertyValue('--color-border').trim(), borderWidth: 1 } }, scales: { x: { ticks: { color: secondary, maxTicksLimit: 6 }, grid: { color: 'rgba(128, 128, 128, 0.1)' } }, y: { ticks: { color: secondary }, grid: { color: 'rgba(128, 128, 128, 0.1)' } } } } };
}

function initializeCharts() {
    if (!statsData.length) return;
    METRICS.forEach(renderSemanticChart);
    if (typeof globalThis.Chart !== 'function') { setDashboardStatus('error', 'Chart rendering is unavailable. The data tables below remain available.'); return; }
    Object.values(charts).forEach(chart => chart?.destroy()); charts = {};
    const labels = statsData.map(point => formatTimestamp(point.timestamp)); const colors = getChartColors();
    METRICS.forEach((metric, metricIndex) => {
        const config = chartOptions();
        const datasets = metric.fields.map(([label, field, unit], index) => ({ label: unit ? `${label} (${unit})` : label, data: statsData.map(point => unit === 'MB' && Number.isFinite(point[field]) ? Math.round(point[field] / 10485.76) / 100 : point[field]), borderColor: colors[(metricIndex * 2 + index) % colors.length], backgroundColor: `${colors[(metricIndex * 2 + index) % colors.length]}20`, fill: false, tension: 0.4, ...(metric.id === 'system' && index === 1 ? { yAxisID: 'y1' } : {}) }));
        if (metric.id === 'system') config.options.scales.y1 = { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false } };
        charts[metric.canvas] = new Chart(document.getElementById(metric.canvas).getContext('2d'), { ...config, data: { labels, datasets } });
    });
}

async function fetchStatsData(url = getStatsUrl(), source = 'network') {
    const safeUrl = safeStatsUrl(url); if (!safeUrl) throw new Error('Statistics URL must be HTTPS, or HTTP on localhost.');
    setDashboardStatus('info', 'Loading dashboard data.');
    const response = await fetch(safeUrl, { mode: 'cors', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`The statistics service returned ${response.status}.`);
    const length = Number(response.headers.get('content-length') || 0); if (length > MAX_STATS_BYTES) throw new Error('Statistics response is larger than the 1 MiB limit.');
    const body = await response.text(); if (body.length > MAX_STATS_BYTES) throw new Error('Statistics response is larger than the 1 MiB limit.');
    const data = JSON.parse(body);
    if (Array.isArray(data) && data.length === 0) { statsData = []; METRICS.forEach(renderSemanticChart); setDashboardStatus('warning', 'No statistics are available yet. Refresh when the service has recorded data.'); return; }
    if (!validStats(data)) throw new Error('Statistics data must contain up to 1,000 numeric records in the expected schema.');
    statsData = data; initializeCharts(); setDashboardStatus('success', `${data.length} statistics records loaded from ${source}.`);
}

async function refreshDashboard() {
    const refresh = document.getElementById('refresh-button'); refresh.disabled = true;
    try { await fetchStatsData(); refresh.focus(); }
    catch (error) { console.error('Failed to refresh dashboard:', error); setDashboardStatus('error', `Unable to load dashboard data: ${error.message} Check the data source and try again.`, { label: 'Retry loading data', handler: refreshDashboard }, true); }
    finally { refresh.disabled = false; }
}

function loadJsonFile(event) {
    const file = event.target.files[0]; const fileButton = document.getElementById('load-file-button');
    const retryFile = () => fileButton.click();
    if (!file) return;
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) { setDashboardStatus('error', 'Choose a JSON statistics file.', { label: 'Choose another file', handler: retryFile }, true); event.target.value = ''; return; }
    if (file.size > MAX_STATS_BYTES) { setDashboardStatus('error', 'The selected file is larger than the 1 MiB limit.', { label: 'Choose another file', handler: retryFile }, true); event.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => { try {
        const data = JSON.parse(reader.result);
        if (Array.isArray(data) && data.length === 0) { statsData = []; METRICS.forEach(renderSemanticChart); setDashboardStatus('warning', 'This file contains no statistics records. Choose another file or refresh the data source.'); return; }
        if (!validStats(data)) throw new Error('The file does not match the required numeric statistics schema.');
        statsData = data; initializeCharts(); document.getElementById('stats-url').textContent = `Local file: ${file.name}`; setDashboardStatus('success', `${data.length} statistics records loaded from ${file.name}.`); fileButton.focus();
    } catch (error) { console.error('Error parsing JSON file:', error); setDashboardStatus('error', `Unable to load this file: ${error.message}`, { label: 'Choose another file', handler: retryFile }, true); } };
    reader.readAsText(file);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('jsonFileInput').addEventListener('change', loadJsonFile);
    document.getElementById('load-file-button').addEventListener('click', () => document.getElementById('jsonFileInput').click());
    document.getElementById('refresh-button').addEventListener('click', refreshDashboard);
    document.getElementById('stats-url').textContent = getStatsUrl(); refreshDashboard();
});
