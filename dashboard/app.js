// Conspire P2P Dashboard Data Configuration
const DEFAULT_STATS_URL = globalThis.ConspireDashboardConfig?.statsUrl ?? '/admin/stats.json';
let statsData = [];
let charts = {}; // Store chart instances for updating

// Chart colors from design system
const colors = ['#1FB8CD', '#FFC185', '#B4413C', '#ECEBD5', '#5D878F', '#DB4545', '#D2BA4C', '#964325', '#944454', '#13343B'];
const MAX_STATS_BYTES = 1024 * 1024;
const MAX_STATS_POINTS = 1000;
const REQUIRED_STAT_FIELDS = ['timestamp', 'ev_peer_connected', 'ev_peer_disconnected'];

function safeStatsUrl(value) {
    try {
        const url = new URL(value, window.location.origin);
        if (!['https:', 'http:'].includes(url.protocol)) return null;
        if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
        return url.href;
    } catch (_) { return null; }
}

function validStats(data) {
    return Array.isArray(data) && data.length > 0 && data.length <= MAX_STATS_POINTS &&
        data.every(point => point && typeof point === 'object' &&
            REQUIRED_STAT_FIELDS.every(field => Number.isFinite(point[field])));
}

function replaceChildren(element, ...children) {
    element.replaceChildren(...children);
}

function messageNode(tag, text) {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
}

function actionButton(label, handler) {
    const button = messageNode('button', label);
    button.type = 'button';
    button.style.cssText = 'background: #c33; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-top: 10px;';
    button.addEventListener('click', handler);
    return button;
}

// Get stats URL from URL parameters or use default
function getStatsUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return safeStatsUrl(urlParams.get('statsUrl') || DEFAULT_STATS_URL) || DEFAULT_STATS_URL;
}

// Fetch stats data from remote URL
async function fetchStatsData(url = getStatsUrl()) {
    try {
        const safeUrl = safeStatsUrl(url);
        if (!safeUrl) throw new Error('Statistics URL must be HTTPS, or HTTP on localhost.');
        showLoadingState();
        const response = await fetch(safeUrl, { mode: 'cors', headers: { 'Accept': 'application/json' } });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
        }
        
        const length = Number(response.headers.get('content-length') || 0);
        if (length > MAX_STATS_BYTES) throw new Error('Statistics response is too large.');
        const body = await response.text();
        if (body.length > MAX_STATS_BYTES) throw new Error('Statistics response is too large.');
        const data = JSON.parse(body);
        if (!validStats(data)) throw new Error('Invalid statistics data.');
        
        statsData = data;
        hideLoadingState();
        return data;
    } catch (error) {
        console.error('Error fetching stats data:', error);
        
        showErrorState('Unable to load statistics data.');
        throw error;
    }
}

// Show loading state
function showLoadingState() {
    const container = document.querySelector('.dashboard-grid');
    if (container) {
        container.style.opacity = '0.5';
    }
    
    // Add loading indicator if it doesn't exist
    let loadingDiv = document.getElementById('loading-indicator');
    if (!loadingDiv) {
        loadingDiv = document.createElement('div');
        loadingDiv.id = 'loading-indicator';
        const text = messageNode('p', 'Loading dashboard data...');
        text.style.cssText = 'text-align: center; padding: 20px; color: var(--color-text-secondary);';
        loadingDiv.appendChild(text);
        document.querySelector('.container').insertBefore(loadingDiv, document.querySelector('.dashboard-grid'));
    }
    loadingDiv.style.display = 'block';
}

// Hide loading state
function hideLoadingState() {
    const container = document.querySelector('.dashboard-grid');
    if (container) {
        container.style.opacity = '1';
    }
    
    const loadingDiv = document.getElementById('loading-indicator');
    if (loadingDiv) {
        loadingDiv.style.display = 'none';
    }
    
    const errorDiv = document.getElementById('error-indicator');
    if (errorDiv) {
        errorDiv.style.display = 'none';
    }
}

// Show error state
function showErrorState(message) {
    const container = document.querySelector('.dashboard-grid');
    if (container) {
        container.style.opacity = '0.3';
    }
    
    // Add error indicator if it doesn't exist
    let errorDiv = document.getElementById('error-indicator');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.id = 'error-indicator';
        errorDiv.style.cssText = 'background: #fee; border: 1px solid #fcc; padding: 20px; margin: 20px 0; border-radius: 8px; color: #c33;';
        document.querySelector('.container').insertBefore(errorDiv, document.querySelector('.dashboard-grid'));
    }
    
    const paragraph = document.createElement('p');
    paragraph.append(messageNode('strong', 'Error loading dashboard data: '), document.createTextNode(` ${message}`));
    replaceChildren(errorDiv, paragraph, actionButton('Retry', retryDataLoad));
    errorDiv.style.display = 'block';
    
    const loadingDiv = document.getElementById('loading-indicator');
    if (loadingDiv) {
        loadingDiv.style.display = 'none';
    }
}


// Retry data loading
async function retryDataLoad() {
    try {
        await fetchStatsData();
        initializeCharts();
    } catch (error) {
        // Error state is already handled in fetchStatsData
    }
}


// Load sample data for demonstration
function loadSampleData() {
    // Sample data similar to the original format
    statsData = [
        {"timestamp":Date.now() * 1000 - 3600000 * 1000,"ev_front_page_loaded":15,"ev_peer_connected":45,"ev_peer_disconnected":42,"ev_peer_zombie_dropped":8,"ev_peer_send_message":28,"ev_peer_share_file":3,"ev_room_created":12,"ev_room_deleted":10,"file_served_bytes":2548192},
        {"timestamp":Date.now() * 1000 - 1800000 * 1000,"ev_front_page_loaded":18,"ev_peer_connected":52,"ev_peer_disconnected":48,"ev_peer_zombie_dropped":9,"ev_peer_send_message":35,"ev_peer_share_file":4,"ev_room_created":15,"ev_room_deleted":13,"file_served_bytes":3247856},
        {"timestamp":Date.now() * 1000,"ev_front_page_loaded":22,"ev_peer_connected":61,"ev_peer_disconnected":55,"ev_peer_zombie_dropped":11,"ev_peer_send_message":42,"ev_peer_share_file":6,"ev_room_created":18,"ev_room_deleted":16,"file_served_bytes":4156320}
    ];
    
    hideLoadingState();
    initializeCharts();
    
    // Update the displayed URL to show we're using sample data
    const statsUrlElement = document.getElementById('stats-url');
    if (statsUrlElement) {
        statsUrlElement.textContent = 'Sample Data (Demo Mode)';
    }
    
    // Show info message
    const errorDiv = document.getElementById('error-indicator');
    if (errorDiv) {
        replaceChildren(errorDiv, messageNode('h4', 'Demo Mode Active'),
            messageNode('p', 'Loading sample data for demonstration. This is not real-time data from the server.'),
            actionButton('Try Real Data Again', retryDataLoad));
    }
}

// Convert microsecond timestamp to readable date
function formatTimestamp(microsecondTimestamp) {
    const date = new Date(microsecondTimestamp / 1000);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

// Extract labels (timestamps) - now dynamic based on loaded data
function getLabels() {
    return statsData.map(item => formatTimestamp(item.timestamp));
}

// Base chart configuration with proper tooltip configuration
const getChartConfig = () => ({
    type: 'line',
    options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false,
        },
        plugins: {
            legend: {
                position: 'top',
                labels: {
                    color: getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim(),
                    font: {
                        size: 12
                    }
                }
            },
            tooltip: {
                enabled: true,
                mode: 'index',
                intersect: false,
                backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim(),
                titleColor: getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim(),
                bodyColor: getComputedStyle(document.documentElement).getPropertyValue('--color-text').trim(),
                borderColor: getComputedStyle(document.documentElement).getPropertyValue('--color-border').trim(),
                borderWidth: 1
            }
        },
        scales: {
            x: {
                ticks: {
                    color: getComputedStyle(document.documentElement).getPropertyValue('--color-text-secondary').trim(),
                    maxTicksLimit: 6
                },
                grid: {
                    color: 'rgba(128, 128, 128, 0.1)'
                }
            },
            y: {
                ticks: {
                    color: getComputedStyle(document.documentElement).getPropertyValue('--color-text-secondary').trim()
                },
                grid: {
                    color: 'rgba(128, 128, 128, 0.1)'
                }
            }
        }
    }
});

// Initialize all charts with current data
function initializeCharts() {
    if (!statsData || statsData.length === 0) {
        console.warn('No stats data available for chart initialization');
        return;
    }

    const labels = getLabels();

    // Destroy existing charts if they exist
    Object.values(charts).forEach(chart => {
        if (chart) chart.destroy();
    });

    // Peer Activity Chart
    const peerCtx = document.getElementById('peerChart').getContext('2d');
    charts.peerChart = new Chart(peerCtx, {
        ...getChartConfig(),
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Peers Connected',
                    data: statsData.map(item => item.ev_peer_connected),
                    borderColor: colors[0],
                    backgroundColor: colors[0] + '20',
                    fill: false,
                    tension: 0.4
                },
                {
                    label: 'Peers Disconnected',
                    data: statsData.map(item => item.ev_peer_disconnected),
                    borderColor: colors[1],
                    backgroundColor: colors[1] + '20',
                    fill: false,
                    tension: 0.4
                },
                {
                    label: 'Zombie Dropped',
                    data: statsData.map(item => item.ev_peer_zombie_dropped),
                    borderColor: colors[2],
                    backgroundColor: colors[2] + '20',
                    fill: false,
                    tension: 0.4
                }
            ]
        }
    });

    // Room Activity Chart
    const roomCtx = document.getElementById('roomChart').getContext('2d');
    charts.roomChart = new Chart(roomCtx, {
        ...getChartConfig(),
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Rooms Created',
                    data: statsData.map(item => item.ev_room_created),
                    borderColor: colors[4],
                    backgroundColor: colors[4] + '20',
                    fill: false,
                    tension: 0.4
                },
                {
                    label: 'Rooms Deleted',
                    data: statsData.map(item => item.ev_room_deleted),
                    borderColor: colors[5],
                    backgroundColor: colors[5] + '20',
                    fill: false,
                    tension: 0.4
                }
            ]
        }
    });

    // Communication Chart
    const commCtx = document.getElementById('communicationChart').getContext('2d');
    charts.communicationChart = new Chart(commCtx, {
        ...getChartConfig(),
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Messages Sent',
                    data: statsData.map(item => item.ev_peer_send_message),
                    borderColor: colors[6],
                    backgroundColor: colors[6] + '20',
                    fill: false,
                    tension: 0.4
                },
                {
                    label: 'Files Shared',
                    data: statsData.map(item => item.ev_peer_share_file),
                    borderColor: colors[7],
                    backgroundColor: colors[7] + '20',
                    fill: false,
                    tension: 0.4
                }
            ]
        }
    });

    // System Metrics Chart with dual y-axis
    const systemCtx = document.getElementById('systemChart').getContext('2d');
    const systemConfig = getChartConfig();
    systemConfig.options.scales.y1 = {
        type: 'linear',
        display: true,
        position: 'right',
        ticks: {
            color: getComputedStyle(document.documentElement).getPropertyValue('--color-text-secondary').trim()
        },
        grid: {
            drawOnChartArea: false
        }
    };

    charts.systemChart = new Chart(systemCtx, {
        ...systemConfig,
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Front Page Loads',
                    data: statsData.map(item => item.ev_front_page_loaded),
                    borderColor: colors[8],
                    backgroundColor: colors[8] + '20',
                    fill: false,
                    tension: 0.4,
                    yAxisID: 'y'
                },
                {
                    label: 'Data Served (MB)',
                    data: statsData.map(item => Math.round(item.file_served_bytes / 1024 / 1024 * 100) / 100),
                    borderColor: colors[9],
                    backgroundColor: colors[9] + '20',
                    fill: false,
                    tension: 0.4,
                    yAxisID: 'y1'
                }
            ]
        }
    });
}

// Refresh dashboard data
async function refreshDashboard() {
    try {
        await fetchStatsData();
        initializeCharts();
    } catch (error) {
        console.error('Failed to refresh dashboard:', error);
        // Error state is already handled in fetchStatsData
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', async function() {
    document.getElementById('jsonFileInput')?.addEventListener('change', loadJsonFile);
    document.getElementById('load-file-button')?.addEventListener('click', () => document.getElementById('jsonFileInput')?.click());
    document.getElementById('refresh-button')?.addEventListener('click', refreshDashboard);
    // Display current stats URL
    const statsUrlElement = document.getElementById('stats-url');
    if (statsUrlElement) {
        statsUrlElement.textContent = getStatsUrl();
    }

    // Load initial data
    try {
        await fetchStatsData();
        initializeCharts();
    } catch (error) {
        console.error('Failed to initialize dashboard:', error);
        // Error state is already handled in fetchStatsData
    }
});

// Load JSON file from local file input
function loadJsonFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
        alert('Please select a JSON file');
        return;
    }
    if (file.size > MAX_STATS_BYTES) {
        alert('JSON file is too large');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            if (!validStats(data)) throw new Error('Invalid JSON statistics data');
            
            statsData = data;
            hideLoadingState();
            initializeCharts();
            
            // Update the displayed URL
            const statsUrlElement = document.getElementById('stats-url');
            if (statsUrlElement) {
                statsUrlElement.textContent = `Local file: ${file.name}`;
            }
            
            // Show success message
            const errorDiv = document.getElementById('error-indicator');
            if (errorDiv) {
                replaceChildren(errorDiv, messageNode('h4', 'File Loaded Successfully'),
                    messageNode('p', `Loaded ${data.length} data points from ${file.name}`));
                setTimeout(() => {
                    errorDiv.style.display = 'none';
                }, 3000);
            }
            
        } catch (error) {
            console.error('Error parsing JSON file:', error);
            alert(`Error loading file: ${error.message}`);
        }
    };
    
    reader.readAsText(file);
}
