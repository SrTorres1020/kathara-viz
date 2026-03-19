import { COLORS, ICONS, svgEl } from '../utils/constants.js';
import { forceDirectedLayout } from '../core/layout.js';
import { updateSidebar, updateStats } from './sidebar.js';

export let currentTopology = null;
export let currentLayout = null;
export let viewBox = { x: 0, y: 0, w: 1200, h: 800 };

export function renderTopology(topology) {
    currentTopology = topology;
    const svg = document.getElementById('topology-svg');
    const container = document.getElementById('canvas-container');
    const rect = container.getBoundingClientRect();
    const W = rect.width || 1200;
    const H = rect.height || 800;

    viewBox = { x: 0, y: 0, w: W, h: H };
    svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);

    const layout = forceDirectedLayout(topology, W, H);
    currentLayout = layout;

    svg.innerHTML = '';

    const defs = svgEl('defs', {}, `
        <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.5"/></filter>
        <pattern id="gridPattern" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#18181b" stroke-width="1"/>
        </pattern>
    `);
    svg.appendChild(defs);

    const grid = svgEl('rect', {
        x: -50000, y: -50000, width: 100000, height: 100000,
        fill: 'url(#gridPattern)', class: 'grid-bg'
    });
    svg.appendChild(grid);

    /**
     * Draw network links between devices and collision domains.
     * We ONLY draw the physical line here. IP labels are drawn under the device 
     * itself to prevent clutter when many devices connect to one domain.
     */
    const linksG = svgEl('g', { class: 'links' });
    for (const edge of layout.edges) {
        const source = layout.nodes.find(n => n.id === edge.source);
        const target = layout.cdNodes.find(n => n.id === edge.target);
        if (!source || !target) continue;

        const line = svgEl('line', {
            x1: source.x, y1: source.y,
            x2: target.x, y2: target.y,
            class: 'link-line',
            'data-source': edge.source,
            'data-target': edge.target
        });
        linksG.appendChild(line);
    }
    svg.appendChild(linksG);

    /**
     * Draw Collision Domains (hubs/subnets).
     */
    const domainsG = svgEl('g', { class: 'domains' });
    for (const cdn of layout.cdNodes) {
        const g = svgEl('g', {
            class: 'domain-group',
            transform: `translate(${cdn.x}, ${cdn.y})`,
            'data-device': cdn.id // added so drag logic can find and move it
        });

        const bgRect = svgEl('rect', {
            x: -30, y: -16, width: 60, height: 32, rx: 8,
            fill: COLORS.domain.fill, stroke: COLORS.domain.stroke,
            'stroke-width': 1.5, 'stroke-dasharray': '4 3'
        });
        g.appendChild(bgRect);

        const label = svgEl('text', {
            x: 0, y: 5, class: 'domain-label', 'font-size': '11'
        }, cdn.data.name);
        g.appendChild(label);

        if (cdn.data.subnet) {
            const sub = svgEl('text', {
                x: 0, y: 24, class: 'ip-label', 'font-size': '9'
            }, cdn.data.subnet);
            g.appendChild(sub);
        }

        // Attach interactivity so domains can be playfully dragged like devices
        g.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            window.startDrag(cdn, e, g);
        });

        domainsG.appendChild(g);
    }
    svg.appendChild(domainsG);

    /**
     * Draw Devices (Routers, Switches, Hosts).
     * Device structure: Name on top, Icon in middle, Type below icon, IPs at the very bottom.
     */
    const devicesG = svgEl('g', { class: 'devices' });
    for (const node of layout.nodes) {
        const d = node.data;
        const c = COLORS[d.type] || COLORS.host;
        const g = svgEl('g', {
            class: 'device-group',
            transform: `translate(${node.x}, ${node.y})`,
            'data-device': d.name
        });

        // 1. Device Name (Top)
        const nameLabel = svgEl('text', { x: 0, y: -40, class: 'device-label' }, d.name);
        g.appendChild(nameLabel);

        // 2. Device Type Indicator (Immediately under name)
        const typeLabel = svgEl('text', { x: 0, y: -28, class: 'device-type-label' }, d.type.toUpperCase());
        g.appendChild(typeLabel);

        // 3. Main Device Shape
        let shape;
        if (d.type === 'router') {
            shape = svgEl('polygon', {
                points: '-30,0 -15,-26 15,-26 30,0 15,26 -15,26',
                class: 'device-shape', fill: c.fill, stroke: c.stroke, 'stroke-width': 2, filter: 'url(#shadow)'
            });
        } else if (d.type === 'switch') {
            shape = svgEl('rect', {
                x: -32, y: -20, width: 64, height: 40, rx: 4,
                class: 'device-shape', fill: c.fill, stroke: c.stroke, 'stroke-width': 2, filter: 'url(#shadow)'
            });
        } else {
            shape = svgEl('rect', {
                x: -28, y: -22, width: 56, height: 44, rx: 10,
                class: 'device-shape', fill: c.fill, stroke: c.stroke, 'stroke-width': 2, filter: 'url(#shadow)'
            });
        }
        g.appendChild(shape);

        // 4. SVG Icon (Inside shape)
        const icon = svgEl('svg', {
            x: -10, y: -14, width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
            stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
        }, `<g color="${c.text}">${ICONS[d.type] || ICONS.host}</g>`);
        g.appendChild(icon);

        // 5. IP Addresses (Stacking below the device shape)
        // This solves the overlapping issue when IPs are drawn on the connection lines.
        let ipStartY = 40;
        for (const iface of d.interfaces) {
            if (iface.ip) {
                const ipText = iface.ip + (iface.netmask ? '/' + iface.netmask : '');

                // Optional: Draw a subtle background for readability if over grid lines
                const textLen = ipText.length * 6; // Rough estimation of monospace width
                const ipBg = svgEl('rect', {
                    x: -(textLen / 2) - 4, y: ipStartY - 9, width: textLen + 8, height: 14, rx: 3,
                    fill: 'var(--bg-primary)', 'fill-opacity': '0.7'
                });
                g.appendChild(ipBg);

                const ipLabel = svgEl('text', {
                    x: 0, y: ipStartY, class: 'ip-label'
                }, ipText);
                g.appendChild(ipLabel);

                ipStartY += 14; // Stack vertically if device has multiple IPs (e.g. Routers)
            }
        }

        // Attach interactivity events
        g.addEventListener('click', (e) => {
            e.stopPropagation();
            window.selectDevice(d.name);
        });

        g.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            window.startDrag(node, e, g);
        });

        devicesG.appendChild(g);
    }
    svg.appendChild(devicesG);

    updateSidebar(topology);
    updateStats(topology);

    document.getElementById('dropzone').classList.add('hidden');
}

export function updateNodePosition(node) {
    const g = document.querySelector(`[data-device="${node.id}"]`);
    if (g) g.setAttribute('transform', `translate(${node.x}, ${node.y})`);

    const svg = document.getElementById('topology-svg');
    svg.querySelectorAll('.link-line').forEach(line => {
        // If the manipulated node is a device (source of connection)
        if (line.getAttribute('data-source') === node.id) {
            line.setAttribute('x1', node.x);
            line.setAttribute('y1', node.y);
        }
        // If the manipulated node is a collision domain (target of connection)
        if (line.getAttribute('data-target') === node.id) {
            line.setAttribute('x2', node.x);
            line.setAttribute('y2', node.y);
        }
    });
}
