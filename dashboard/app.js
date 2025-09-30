// Conspire P2P Dashboard Data Configuration
const DEFAULT_STATS_URL = 'https://conspire.dyne.org:8443/admin/stats.json';
let statsData = [];
let charts = {}; // Store chart instances for updating

// Chart colors from design system
const colors = ['#1FB8CD', '#FFC185', '#B4413C', '#ECEBD5', '#5D878F', '#DB4545', '#D2BA4C', '#964325', '#944454', '#13343B'];

// Get stats URL from URL parameters or use default
function getStatsUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('statsUrl') || DEFAULT_STATS_URL;
}

// Fetch stats data from remote URL
async function fetchStatsData(url = getStatsUrl()) {
    try {
        showLoadingState();
        
        // Try to fetch with CORS first
        let response;
        try {
            response = await fetch(url, {
                mode: 'cors',
                headers: {
                    'Accept': 'application/json',
                }
            });
        } catch (corsError) {
            // If CORS fails, try with no-cors mode (limited functionality)
            console.warn('CORS request failed, trying alternative methods:', corsError.message);
            throw new Error(`CORS policy blocked request to ${url}. This usually means the server doesn't allow cross-origin requests from this domain.`);
        }
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!Array.isArray(data)) {
            throw new Error('Invalid data format: expected an array');
        }
        
        if (data.length === 0) {
            throw new Error('No statistics data available');
        }
        
        statsData = data;
        hideLoadingState();
        return data;
    } catch (error) {
        console.error('Error fetching stats data:', error);
        
        // Try to use fallback data or suggest solutions
        if (error.message.includes('CORS')) {
            showCorsErrorState(url);
        } else {
            showErrorState(error.message);
        }
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
        loadingDiv.innerHTML = '<p style="text-align: center; padding: 20px; color: var(--color-text-secondary);">Loading dashboard data...</p>';
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
    
    errorDiv.innerHTML = `
        <p><strong>Error loading dashboard data:</strong> ${message}</p>
        <button onclick="retryDataLoad()" style="background: #c33; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-top: 10px;">Retry</button>
    `;
    errorDiv.style.display = 'block';
    
    const loadingDiv = document.getElementById('loading-indicator');
    if (loadingDiv) {
        loadingDiv.style.display = 'none';
    }
}

// Show CORS-specific error with solutions
function showCorsErrorState(url) {
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
    
    errorDiv.innerHTML = `
        <h3>CORS Policy Error</h3>
        <p><strong>Cannot access data from:</strong> <code>${url}</code></p>
        <p>This error occurs because the server doesn't allow cross-origin requests from this domain.</p>
        
        <h4>Solutions:</h4>
        <ul style="text-align: left; margin: 10px 0;">
            <li><strong>Serve from same domain:</strong> Host this dashboard on the same server as the stats endpoint</li>
            <li><strong>Use CORS proxy:</strong> Try a proxy service like <code>https://cors-anywhere.herokuapp.com/${url}</code></li>
            <li><strong>Server configuration:</strong> Add CORS headers to the stats endpoint</li>
            <li><strong>Local development:</strong> Use <code>--disable-web-security</code> flag with Chrome (development only)</li>
        </ul>
        
        <div style="margin-top: 15px;">
            <button onclick="tryProxyUrl()" style="background: #0066cc; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-right: 10px;">Try CORS Proxy</button>
            <button onclick="loadSampleData()" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-right: 10px;">Load Sample Data</button>
            <button onclick="retryDataLoad()" style="background: #c33; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Retry</button>
        </div>
    `;
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

// Try using a CORS proxy
async function tryProxyUrl() {
    const originalUrl = getStatsUrl();
    const proxyUrl = `https://cors-anywhere.herokuapp.com/${originalUrl}`;
    
    try {
        await fetchStatsData(proxyUrl);
        initializeCharts();
        
        // Update the displayed URL to show we're using proxy
        const statsUrlElement = document.getElementById('stats-url');
        if (statsUrlElement) {
            statsUrlElement.innerHTML = `${originalUrl} <em>(via CORS proxy)</em>`;
        }
    } catch (error) {
        console.error('CORS proxy also failed:', error);
        showErrorState('CORS proxy request also failed. The proxy service might be unavailable.');
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
        statsUrlElement.innerHTML = '<em>Sample Data (Demo Mode)</em>';
    }
    
    // Show info message
    const errorDiv = document.getElementById('error-indicator');
    if (errorDiv) {
        errorDiv.innerHTML = `
            <div style="background: #e7f3ff; border: 1px solid #bee5eb; color: #0c5460; padding: 15px; border-radius: 8px;">
                <h4>Demo Mode Active</h4>
                <p>Loading sample data for demonstration. This is not real-time data from the server.</p>
                <button onclick="retryDataLoad()" style="background: #0066cc; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Try Real Data Again</button>
            </div>
        `;
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
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            if (!Array.isArray(data)) {
                throw new Error('Invalid JSON format: expected an array');
            }
            
            // Validate data structure
            if (data.length > 0) {
                const requiredFields = ['timestamp', 'ev_peer_connected', 'ev_peer_disconnected'];
                const firstItem = data[0];
                const missingFields = requiredFields.filter(field => !(field in firstItem));
                
                if (missingFields.length > 0) {
                    throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
                }
            }
            
            statsData = data;
            hideLoadingState();
            initializeCharts();
            
            // Update the displayed URL
            const statsUrlElement = document.getElementById('stats-url');
            if (statsUrlElement) {
                statsUrlElement.innerHTML = `<em>Local file: ${file.name}</em>`;
            }
            
            // Show success message
            const errorDiv = document.getElementById('error-indicator');
            if (errorDiv) {
                errorDiv.innerHTML = `
                    <div style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 8px;">
                        <h4>File Loaded Successfully</h4>
                        <p>Loaded ${data.length} data points from ${file.name}</p>
                    </div>
                `;
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