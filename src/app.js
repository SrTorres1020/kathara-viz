import { buildTopology } from './core/parser.js';
import { renderTopology, updateNodePosition, currentLayout, viewBox } from './ui/renderer.js';
import { selectDevice, backToList } from './ui/sidebar.js';
import { svgPoint, loadIcons } from './utils/constants.js';
import { SimulationEngine } from './core/simulator.js';
import { Animator } from './ui/animator.js';
import { Dashboard } from './ui/dashboard.js';
import { LiveBridge } from './core/live-bridge.js';
import { TerminalManager } from './ui/terminal.js';

// Initialize external SVG icons
loadIcons();

// Expose to window for inline onclick handlers
window.selectDevice = selectDevice;
window.backToList = backToList;

let isPanning = false;
let panStart = { x: 0, y: 0 };
let dragDevice = null;
let dragOffset = { x: 0, y: 0 };

// ═══════════════════════════════════════════════════════
// Simulation State
// ═══════════════════════════════════════════════════════
let simEngine = null;
let simAnimator = null;
let simDashboard = null;
let liveBridge = null;       // Live capture bridge (WebSocket to bridge.py)
let terminalManager = null;  // Terminal manager (web terminals for containers)
let pingMode = false;       // When true, next two device clicks form a ping
let pingSource = null;      // First device selected in ping mode
let autoTrafficActive = false;

window.startDrag = function (node, e, g) {
    dragDevice = node;
    const svg = document.getElementById('topology-svg');
    const pt = svgPoint(e, svg);
    dragOffset.x = pt.x - node.x;
    dragOffset.y = pt.y - node.y;
    g.style.cursor = 'grabbing';
};

document.getElementById('canvas-container').addEventListener('mousedown', (e) => {
    if (dragDevice) return;
    isPanning = true;
    panStart.x = e.clientX;
    panStart.y = e.clientY;
});

window.addEventListener('mousemove', (e) => {
    const svg = document.getElementById('topology-svg');

    if (dragDevice) {
        const pt = svgPoint(e, svg);
        dragDevice.x = pt.x - dragOffset.x;
        dragDevice.y = pt.y - dragOffset.y;
        updateNodePosition(dragDevice);
        return;
    }

    if (isPanning) {
        const scale = viewBox.w / (svg.getBoundingClientRect().width || 1);
        const dx = (e.clientX - panStart.x) * scale;
        const dy = (e.clientY - panStart.y) * scale;
        viewBox.x -= dx;
        viewBox.y -= dy;
        svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
        panStart.x = e.clientX;
        panStart.y = e.clientY;
    }
});

window.addEventListener('mouseup', () => {
    isPanning = false;
    if (dragDevice) {
        const g = document.querySelector(`[data-device="${dragDevice.id}"]`);
        if (g) g.style.cursor = 'pointer';
        dragDevice = null;
    }
});

document.getElementById('canvas-container').addEventListener('wheel', (e) => {
    e.preventDefault();
    const svg = document.getElementById('topology-svg');
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
    const pt = svgPoint(e, svg);
    viewBox.x = pt.x - (pt.x - viewBox.x) * zoomFactor;
    viewBox.y = pt.y - (pt.y - viewBox.y) * zoomFactor;
    viewBox.w *= zoomFactor;
    viewBox.h *= zoomFactor;
    svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}, { passive: false });

document.getElementById('zoom-in').addEventListener('click', () => zoom(0.8));
document.getElementById('zoom-out').addEventListener('click', () => zoom(1.25));
document.getElementById('zoom-fit').addEventListener('click', fitView);

function zoom(factor) {
    const svg = document.getElementById('topology-svg');
    const cx = viewBox.x + viewBox.w / 2;
    const cy = viewBox.y + viewBox.h / 2;
    viewBox.w *= factor;
    viewBox.h *= factor;
    viewBox.x = cx - viewBox.w / 2;
    viewBox.y = cy - viewBox.h / 2;
    svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}

function fitView() {
    if (!currentLayout) return;
    const all = [...currentLayout.nodes, ...currentLayout.cdNodes];
    if (all.length === 0) return;
    const pad = 100;
    const minX = Math.min(...all.map(n => n.x)) - pad;
    const minY = Math.min(...all.map(n => n.y)) - pad;
    const maxX = Math.max(...all.map(n => n.x)) + pad;
    const maxY = Math.max(...all.map(n => n.y)) + pad;
    viewBox.x = minX;
    viewBox.y = minY;
    viewBox.w = maxX - minX;
    viewBox.h = maxY - minY;
    document.getElementById('topology-svg').setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}

async function handleFiles(fileList) {
    const files = {};
    for (const file of fileList) {
        const name = file.webkitRelativePath
            ? file.webkitRelativePath.split('/').pop()
            : file.name;
        if (name === 'lab.conf' || name.endsWith('.startup')) {
            files[name] = await file.text();
        }
    }
    if (!files['lab.conf']) {
        alert('No lab.conf file found. Please upload a Kathara lab folder containing a lab.conf file.');
        return;
    }
    const topology = buildTopology(files);
    if (topology) {
        renderTopology(topology);
        initSimulation(topology);
    }
}

const dropzone = document.getElementById('dropzone-box');
const dzEl = document.getElementById('dropzone');

dzEl.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dzEl.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dzEl.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');

    const items = e.dataTransfer.items;
    if (items) {
        const allFiles = [];
        const promises = [];
        for (const item of items) {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
            if (entry) {
                promises.push(readEntry(entry, allFiles));
            }
        }
        Promise.all(promises).then(() => processEntryFiles(allFiles));
    } else if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
    }
});

function readEntry(entry, allFiles) {
    return new Promise((resolve) => {
        if (entry.isFile) {
            entry.file(f => { allFiles.push(f); resolve(); });
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            reader.readEntries((entries) => {
                Promise.all(entries.map(e => readEntry(e, allFiles))).then(resolve);
            });
        } else {
            resolve();
        }
    });
}

async function processEntryFiles(files) {
    const fileMap = {};
    for (const f of files) {
        const name = f.name;
        if (name === 'lab.conf' || name.endsWith('.startup')) {
            fileMap[name] = await f.text();
        }
    }
    if (!fileMap['lab.conf']) {
        alert('No lab.conf file found in the dropped folder.');
        return;
    }
    const topology = buildTopology(fileMap);
    if (topology) {
        renderTopology(topology);
        initSimulation(topology);
    }
}

document.getElementById('file-input').addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFiles(e.target.files);
});

document.getElementById('btn-parse-paste').addEventListener('click', () => {
    const text = document.getElementById('paste-area').value.trim();
    if (!text) return;
    const files = { 'lab.conf': text };
    const topology = buildTopology(files);
    if (topology) {
        renderTopology(topology);
        initSimulation(topology);
    }
});

document.getElementById('btn-load').addEventListener('click', () => {
    document.getElementById('dropzone').classList.remove('hidden');
});

document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
});

document.getElementById('btn-export').addEventListener('click', () => {
    const svg = document.getElementById('topology-svg');
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kathara-topology.svg';
    a.click();
    URL.revokeObjectURL(url);
});

// ═══════════════════════════════════════════════════════
// SIMULATION INTEGRATION
// ═══════════════════════════════════════════════════════

/**
 * Initialize the simulation engine, animator, and dashboard
 * after a topology has been rendered. This is called every time
 * a new lab is loaded, ensuring the simulation is topology-agnostic.
 */
function initSimulation(topology) {
    // Clean up any previous simulation
    if (simEngine) simEngine.stop();
    if (simDashboard) simDashboard.destroy();

    // Create fresh instances bound to the current topology
    simEngine = new SimulationEngine(topology, currentLayout);
    simAnimator = new Animator(currentLayout);
    simDashboard = new Dashboard(simEngine);

    // Connect the tick event to the animator
    simEngine.on('tick', (activePackets) => {
        simAnimator.update(activePackets);
    });

    // Show the simulation toolbar
    document.getElementById('sim-toolbar').classList.remove('hidden');

    // Reset toolbar button states
    document.getElementById('btn-sim-play').style.display = '';
    document.getElementById('btn-sim-pause').style.display = 'none';
    document.getElementById('btn-sim-ping').classList.remove('active');
    document.getElementById('btn-sim-auto').classList.remove('active');
    pingMode = false;
    pingSource = null;
    autoTrafficActive = false;

    // Clean up previous live bridge
    if (liveBridge) liveBridge.disconnect();
    liveBridge = new LiveBridge(topology, simEngine);

    // Update the Go Live button based on connection status
    const liveBtn = document.getElementById('btn-sim-live');
    liveBtn.className = 'btn btn-live';
    liveBridge.onStatusChange = (status) => {
        liveBtn.className = 'btn btn-live';
        if (status === 'connected') liveBtn.classList.add('connected');
        else if (status === 'connecting') liveBtn.classList.add('active');

        // Update terminal WebSocket reference on connect/disconnect
        if (terminalManager) {
            terminalManager.setWebSocket(status === 'connected' ? liveBridge.getWebSocket() : null);
        }
    };

    // Initialize terminal manager (singleton, survives topology reloads)
    if (!terminalManager) {
        terminalManager = new TerminalManager();
        // Wire terminal panel header buttons
        document.getElementById('terminal-toggle').addEventListener('click', () => {
            if (terminalManager) terminalManager.toggle();
        });
        document.getElementById('terminal-close-all').addEventListener('click', () => {
            if (terminalManager) terminalManager.closeAll();
        });
    } else {
        terminalManager.closeAll();
    }

    // Route terminal messages from bridge to TerminalManager
    liveBridge.terminalMessageHandler = (msg) => {
        if (terminalManager) terminalManager.handleMessage(msg);
    };

    // Expose openTerminalForDevice globally (called from sidebar button)
    window.openTerminalForDevice = (deviceName) => {
        if (!terminalManager) return;
        if (!liveBridge || !liveBridge.connected) {
            console.warn('[Terminal] Bridge is not connected. Click Go Live first.');
            return;
        }
        terminalManager.setWebSocket(liveBridge.getWebSocket());
        terminalManager.open(deviceName);
    };
}

// ── Play / Pause ──
document.getElementById('btn-sim-play').addEventListener('click', () => {
    if (!simEngine) return;
    simEngine.start();
    document.getElementById('btn-sim-play').style.display = 'none';
    document.getElementById('btn-sim-pause').style.display = '';
});

document.getElementById('btn-sim-pause').addEventListener('click', () => {
    if (!simEngine) return;
    simEngine.pause();
    document.getElementById('btn-sim-play').style.display = '';
    document.getElementById('btn-sim-pause').style.display = 'none';
});

// ── Ping Mode ──
// Click "Ping", then click a source device, then click a destination device.
document.getElementById('btn-sim-ping').addEventListener('click', () => {
    pingMode = !pingMode;
    pingSource = null;
    document.getElementById('btn-sim-ping').classList.toggle('active', pingMode);
    document.body.style.cursor = pingMode ? 'crosshair' : '';
});

// Override device click when ping mode is active
const originalSelectDevice = selectDevice;
window.selectDevice = function (name) {
    if (pingMode && simEngine) {
        if (!pingSource) {
            // First click: select source
            pingSource = name;
            // Highlight the source device
            const el = document.querySelector(`[data-device="${name}"] .device-shape`);
            if (el) el.setAttribute('filter', 'url(#glow)');
        } else {
            // Second click: send ping and exit ping mode
            if (!simEngine.running) simEngine.start();
            simEngine.ping(pingSource, name);

            // Reset glow on source
            const el = document.querySelector(`[data-device="${pingSource}"] .device-shape`);
            if (el) el.removeAttribute('filter');

            pingSource = null;
            pingMode = false;
            document.getElementById('btn-sim-ping').classList.remove('active');
            document.body.style.cursor = '';

            // Show play/pause state
            document.getElementById('btn-sim-play').style.display = 'none';
            document.getElementById('btn-sim-pause').style.display = '';
        }
        return;
    }
    originalSelectDevice(name);
};

// ── Auto Traffic ──
document.getElementById('btn-sim-auto').addEventListener('click', () => {
    if (!simEngine) return;
    autoTrafficActive = !autoTrafficActive;
    document.getElementById('btn-sim-auto').classList.toggle('active', autoTrafficActive);

    if (autoTrafficActive) {
        if (!simEngine.running) simEngine.start();
        simEngine.startAutoTraffic(1500);
        document.getElementById('btn-sim-play').style.display = 'none';
        document.getElementById('btn-sim-pause').style.display = '';
    } else {
        simEngine.stopAutoTraffic();
    }
});

// ── Speed Slider ──
document.getElementById('sim-speed-slider').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById('sim-speed-val').textContent = val + 'x';
    if (simEngine) simEngine.speed = val;
});

// ── Dashboard Toggle ──
document.getElementById('btn-sim-dashboard').addEventListener('click', () => {
    if (simDashboard) simDashboard.toggle();
});

// ── Go Live (connects to bridge.py WebSocket) ──
document.getElementById('btn-sim-live').addEventListener('click', () => {
    if (!liveBridge) return;

    if (liveBridge.connected) {
        // Disconnect
        liveBridge.disconnect();
    } else {
        // Connect — prompt for URL if not default
        const defaultUrl = 'ws://localhost:9000';
        liveBridge.connect(defaultUrl);

        // Start the simulation if not running
        if (simEngine && !simEngine.running) {
            simEngine.start();
            document.getElementById('btn-sim-play').style.display = 'none';
            document.getElementById('btn-sim-pause').style.display = '';
        }
    }
});
