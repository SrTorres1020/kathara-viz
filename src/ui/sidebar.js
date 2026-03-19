import { COLORS } from '../utils/constants.js';
import { currentTopology } from './renderer.js';

export let selectedDevice = null;

export function updateSidebar(topology) {
    const content = document.getElementById('sidebar-content');
    document.getElementById('device-count').textContent = topology.devices.length + ' devices';

    let html = '';
    const groups = { router: [], switch: [], host: [] };
    for (const d of topology.devices) {
        (groups[d.type] || groups.host).push(d);
    }

    for (const [type, devices] of Object.entries(groups)) {
        if (devices.length === 0) continue;
        const typeNames = { router: 'Routers', switch: 'Switches', host: 'Hosts' };
        html += `<div class="sidebar-section">
            <div class="sidebar-section-title">${typeNames[type]} (${devices.length})</div>`;
        for (const d of devices) {
            const ips = d.interfaces.map(i => i.ip).filter(Boolean).join(', ') || 'No IP';
            html += `<div class="device-card" data-card="${d.name}" onclick="window.selectDevice('${d.name}')">
                <div class="device-card-header">
                    <span class="device-card-name">${d.name}</span>
                    <span class="device-card-type type-${d.type}">${d.type}</span>
                </div>
                <div class="device-card-detail">${ips}</div>
            </div>`;
        }
        html += '</div>';
    }

    html += `<div class="sidebar-section">
        <div class="sidebar-section-title">Collision Domains (${topology.collisionDomains.length})</div>`;
    for (const cd of topology.collisionDomains) {
        html += `<div class="device-card">
            <div class="device-card-header">
                <span class="device-card-name">${cd.name}</span>
                <span class="device-card-type" style="background:rgba(113,113,122,0.15);color:#a1a1aa">${cd.devices.length} links</span>
            </div>
            <div class="device-card-detail">${cd.subnet || 'No subnet info'}</div>
        </div>`;
    }
    html += '</div>';

    content.innerHTML = html;
}

export function showDeviceDetail(device) {
    const content = document.getElementById('sidebar-content');
    const c = COLORS[device.type] || COLORS.host;

    let html = `<div class="detail-panel fade-in">
        <div class="detail-title">
            <span style="color:${c.text}">●</span> ${device.name}
            <span class="device-card-type type-${device.type}" style="margin-left:auto">${device.type}</span>
        </div>`;

    html += '<div class="detail-section-title">Interfaces</div>';
    for (const iface of device.interfaces) {
        html += `<div class="detail-row">
            <span class="detail-key">eth${iface.index} → ${iface.collisionDomain}</span>
            <span class="detail-val">${iface.ip ? iface.ip + (iface.netmask ? '/' + iface.netmask : '') : 'no ip'}</span>
        </div>`;
    }

    if (device.gateway) {
        html += `<div class="detail-row"><span class="detail-key">Gateway</span><span class="detail-val">${device.gateway}</span></div>`;
    }

    const opts = Object.entries(device.options || {});
    if (opts.length > 0) {
        html += '<div class="detail-section-title">Options</div>';
        for (const [k, v] of opts) {
            html += `<div class="detail-row"><span class="detail-key">${k}</span><span class="detail-val">${v}</span></div>`;
        }
    }

    if (device.startupCmds && device.startupCmds.length > 0) {
        html += '<div class="detail-section-title">Startup Commands</div>';
        for (const cmd of device.startupCmds) {
            html += `<div class="detail-cmd">${cmd}</div>`;
        }
    }

    html += `<div style="margin-top:12px; display:flex; flex-direction:column; gap:6px;">
        <button class="btn-open-terminal" id="btn-open-terminal" onclick="window.openTerminalForDevice && window.openTerminalForDevice('${device.name}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
            Open Terminal
        </button>
        <button class="btn" style="width:100%" onclick="window.backToList()">← Back to list</button>
    </div></div>`;

    content.innerHTML = html;
}

export function backToList() {
    selectedDevice = null;
    document.querySelectorAll('.device-group .device-shape').forEach(s => s.removeAttribute('filter'));
    if (currentTopology) updateSidebar(currentTopology);
}

export function updateStats(topology) {
    const counts = { host: 0, router: 0, switch: 0 };
    for (const d of topology.devices) counts[d.type] = (counts[d.type] || 0) + 1;
    document.getElementById('stat-hosts').textContent = counts.host;
    document.getElementById('stat-routers').textContent = counts.router;
    document.getElementById('stat-switches').textContent = counts.switch;
    document.getElementById('stat-domains').textContent = topology.collisionDomains.length;
}

export function selectDevice(name) {
    selectedDevice = name;
    if (!currentTopology) return;
    const device = currentTopology.devices.find(d => d.name === name);
    if (!device) return;

    document.querySelectorAll('.device-card').forEach(c => c.classList.remove('active'));
    const card = document.querySelector(`[data-card="${name}"]`);
    if (card) card.classList.add('active');

    document.querySelectorAll('.device-group').forEach(g => {
        const shape = g.querySelector('.device-shape');
        if (shape) shape.removeAttribute('filter');
    });
    const svgNode = document.querySelector(`[data-device="${name}"] .device-shape`);
    if (svgNode) svgNode.setAttribute('filter', 'url(#glow)');

    showDeviceDetail(device);
}
