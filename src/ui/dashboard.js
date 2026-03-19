/**
 * ═══════════════════════════════════════════════════════
 * Dashboard — Live Network Traffic Statistics Panel
 * ═══════════════════════════════════════════════════════
 * 
 * Renders a collapsible bottom panel with real-time traffic
 * visualizations. All charts are drawn using vanilla HTML5 Canvas
 * (zero external dependencies).
 * 
 * Widgets:
 *   1. Traffic Timeline   — Rolling line chart (packets/second, last 60s)
 *   2. Protocol Breakdown — Donut chart (ICMP, TCP, UDP, HTTP, DNS)
 *   3. Packet Log         — Scrolling table of recent packets
 * 
 * @module ui/dashboard
 */

import { PROTOCOLS } from '../core/simulator.js';

/**
 * Manages the dashboard panel UI and its chart rendering.
 */
export class Dashboard {
    /**
     * @param {SimulationEngine} engine - Reference to the simulation engine
     */
    constructor(engine) {
        /** @type {SimulationEngine} */
        this.engine = engine;

        /** @type {boolean} Whether the dashboard is visible */
        this.visible = false;

        /** @type {number|null} Interval for refreshing charts */
        this._refreshInterval = null;

        /** @type {number|null} rAF handle */
        this._rafId = null;

        // ── Interpolation state for smooth animations ──
        // Timeline: we lerp the "current partial second" count smoothly
        this._timelineDisplay = [];     // The values currently being drawn (lerped)
        this._timelineTarget = [];      // The target snapshot from the engine
        this._timelineLerpSpeed = 4;    // Units per second to catch up

        // Donut: we lerp each protocol's visual ratio
        this._donutDisplay = {};        // { ICMP: 0.3, TCP: 0.2, ... } currently drawn
        this._donutTarget = {};         // target ratios

        // Counter display values
        this._displayTotal = 0;
        this._displayPPS = 0;

        this._lastFrameTime = performance.now();

        this._initDOM();
        this._bindEvents();
        this._startRefresh();
    }

    // ───────────────────────────────────────────────────
    // DOM Construction
    // ───────────────────────────────────────────────────

    /**
     * Build the dashboard HTML structure and inject it into the page.
     * @private
     */
    _initDOM() {
        const container = document.getElementById('dashboard');
        if (!container) return;

        container.innerHTML = `
            <div class="dashboard-header">
                <div class="dashboard-title">
                    <span class="dashboard-dot"></span>
                    Network Activity
                </div>
                <div class="dashboard-stats">
                    <span id="dash-total">0 packets</span>
                    <span id="dash-pps">0 pkt/s</span>
                </div>
                <button class="btn dashboard-toggle-btn" id="dash-toggle-btn">▼</button>
            </div>
            <div class="dashboard-body" id="dashboard-body">
                <div class="dashboard-grid">
                    <div class="dashboard-card">
                        <div class="dashboard-card-title">Traffic Timeline</div>
                        <canvas id="chart-timeline"></canvas>
                    </div>
                    <div class="dashboard-card">
                        <div class="dashboard-card-title">Protocol Distribution</div>
                        <canvas id="chart-protocols"></canvas>
                    </div>
                    <div class="dashboard-card dashboard-card-log">
                        <div class="dashboard-card-title">Packet Log</div>
                        <div class="packet-log-container" id="packet-log"></div>
                    </div>
                </div>
            </div>
        `;

        // Setup HiDPI canvases after DOM is injected
        this._setupCanvas('chart-timeline');
        this._setupCanvas('chart-protocols');
    }

    /**
     * Configure a canvas element for crisp HiDPI rendering.
     * Scales the internal pixel buffer by devicePixelRatio while
     * keeping the CSS display size unchanged.
     * 
     * @param {string} id - Canvas element ID
     * @private
     */
    _setupCanvas(id) {
        const canvas = document.getElementById(id);
        if (!canvas) return;

        // Use a ResizeObserver to auto-size the canvas to its CSS container
        const observer = new ResizeObserver(() => {
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
        });
        observer.observe(canvas);
    }

    /**
     * Get the logical (CSS) dimensions of a canvas, accounting for DPR scaling.
     * @param {HTMLCanvasElement} canvas
     * @returns {{ w: number, h: number }}
     * @private
     */
    _getCanvasSize(canvas) {
        const rect = canvas.getBoundingClientRect();
        return { w: rect.width, h: rect.height };
    }

    /**
     * Bind click events for toggling the dashboard.
     * @private
     */
    _bindEvents() {
        const toggleBtn = document.getElementById('dash-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggle());
        }
    }

    // ───────────────────────────────────────────────────
    // Visibility
    // ───────────────────────────────────────────────────

    /** Show the dashboard panel. */
    show() {
        this.visible = true;
        const el = document.getElementById('dashboard');
        if (el) el.classList.add('open');
        const btn = document.getElementById('dash-toggle-btn');
        if (btn) btn.textContent = '▼';
    }

    /** Hide the dashboard panel. */
    hide() {
        this.visible = false;
        const el = document.getElementById('dashboard');
        if (el) el.classList.remove('open');
        const btn = document.getElementById('dash-toggle-btn');
        if (btn) btn.textContent = '▲';
    }

    /** Toggle dashboard visibility. */
    toggle() {
        this.visible ? this.hide() : this.show();
    }

    // ───────────────────────────────────────────────────
    // Refresh Loop
    // ───────────────────────────────────────────────────

    /**
     * Start the dashboard refresh loops.
     * Charts use requestAnimationFrame for smooth 60fps rendering with interpolation.
     * The packet log uses a slower 1s interval (DOM manipulation is expensive).
     * @private
     */
    _startRefresh() {
        // Snapshot engine data every 250ms as lerp targets
        this._refreshInterval = setInterval(() => {
            this._snapshotTargets();
            if (this.visible) this._updatePacketLog();
        }, 250);

        // 60fps render loop with smooth interpolation
        const chartLoop = () => {
            const now = performance.now();
            const dt = (now - this._lastFrameTime) / 1000;
            this._lastFrameTime = now;

            if (this.visible) {
                this._lerpValues(dt);
                this._updateCounters();
                this._drawTimeline();
                this._drawProtocolChart();
            }
            this._rafId = requestAnimationFrame(chartLoop);
        };
        this._rafId = requestAnimationFrame(chartLoop);
    }

    /**
     * Capture the current engine stats as interpolation targets.
     * Called periodically (every 250ms) so the animation has something to lerp toward.
     * @private
     */
    _snapshotTargets() {
        const stats = this.engine.stats;

        // Donut: compute fractional ratios as targets
        const total = Object.values(stats.byProtocol).reduce((s, v) => s + v, 0) || 1;
        this._donutTarget = {};
        for (const [key, count] of Object.entries(stats.byProtocol)) {
            this._donutTarget[key] = count / total;
        }

        // Counters
        this._targetTotal = stats.totalPackets;
        const pps = stats.packetsPerSecond;
        this._targetPPS = pps.length > 0 ? pps[pps.length - 1] : 0;
    }

    /**
     * Smoothly interpolate display values toward their targets.
     * Uses exponential easing for fluid motion.
     * @param {number} dt - Delta time in seconds
     * @private
     */
    _lerpValues(dt) {
        const ease = 1 - Math.exp(-8 * dt);

        // Donut ratios interpolation
        for (const key of Object.keys(this._donutTarget)) {
            if (this._donutDisplay[key] === undefined) this._donutDisplay[key] = 0;
            this._donutDisplay[key] += (this._donutTarget[key] - this._donutDisplay[key]) * ease;
        }

        // Counter interpolation
        this._displayTotal += (this._targetTotal - this._displayTotal) * ease;
        this._displayPPS += (this._targetPPS - this._displayPPS) * ease;
    }

    // ───────────────────────────────────────────────────
    // Widget: Counters
    // ───────────────────────────────────────────────────

    /** Update the header counters using interpolated values. @private */
    _updateCounters() {
        const totalEl = document.getElementById('dash-total');
        const ppsEl = document.getElementById('dash-pps');

        if (totalEl) totalEl.textContent = `${Math.round(this._displayTotal)} packets`;
        if (ppsEl) ppsEl.textContent = `${Math.round(this._displayPPS)} pkt/s`;
    }

    // ───────────────────────────────────────────────────
    // Widget: Traffic Timeline (Line Chart)
    // ───────────────────────────────────────────────────

    /**
     * Draw a rolling line chart of packets-per-second over the last 60 seconds.
     * Uses vanilla HTML5 Canvas.
     * @private
     */
    _drawTimeline() {
        const canvas = document.getElementById('chart-timeline');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const { w, h } = this._getCanvasSize(canvas);

        // Use raw integer data directly from the engine — no lerp
        const raw = this.engine.stats.packetsPerSecond;
        const data = [...raw, this.engine.stats._currentSecondCount];

        ctx.clearRect(0, 0, w, h);

        // Background grid
        ctx.strokeStyle = '#27272a';
        ctx.lineWidth = 0.5;
        for (let y = 0; y < h; y += 30) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        if (data.length < 2) return;

        const maxVal = Math.max(...data, 1);
        const stepX = w / 59;
        const pad = 10;

        // Helper: compute Y for a data value
        const toY = (val) => h - pad - ((val / maxVal) * (h - pad * 2));

        // Convert data to (x, y) points
        const points = data.map((v, i) => ({ x: i * stepX, y: toY(v) }));

        // ── Draw filled area with smooth Bézier curves ──
        ctx.beginPath();
        ctx.moveTo(points[0].x, h);
        ctx.lineTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const cur = points[i];
            const cpx = (prev.x + cur.x) / 2;
            ctx.bezierCurveTo(cpx, prev.y, cpx, cur.y, cur.x, cur.y);
        }
        ctx.lineTo(points[points.length - 1].x, h);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, 'rgba(16, 185, 129, 0.3)');
        gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
        ctx.fillStyle = gradient;
        ctx.fill();

        // ── Draw the smooth line ──
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const cur = points[i];
            const cpx = (prev.x + cur.x) / 2;
            ctx.bezierCurveTo(cpx, prev.y, cpx, cur.y, cur.x, cur.y);
        }
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Current value label
        const lastVal = data[data.length - 1];
        ctx.fillStyle = '#fafafa';
        ctx.font = '11px Inter, sans-serif';
        ctx.fillText(`${lastVal} pkt/s`, w - 60, 14);
    }

    // ───────────────────────────────────────────────────
    // Widget: Protocol Distribution (Donut Chart)
    // ───────────────────────────────────────────────────

    /**
     * Draw a donut chart showing protocol distribution.
     * @private
     */
    _drawProtocolChart() {
        const canvas = document.getElementById('chart-protocols');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const { w, h } = this._getCanvasSize(canvas);
        const rawData = this.engine.stats.byProtocol;

        ctx.clearRect(0, 0, w, h);

        const total = Object.values(rawData).reduce((s, v) => s + v, 0);
        if (total === 0) {
            ctx.fillStyle = '#71717a';
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data', w / 2, h / 2 + 4);
            return;
        }

        const cx = w * 0.35;
        const cy = h / 2;
        const outerR = Math.min(w * 0.3, h * 0.4);
        const innerR = outerR * 0.55;

        let startAngle = -Math.PI / 2;

        // Use interpolated ratios for smooth arc transitions
        for (const key of Object.keys(rawData)) {
            const proto = PROTOCOLS[key] || { color: '#71717a' };
            const ratio = this._donutDisplay[key] || 0;
            const sliceAngle = ratio * 2 * Math.PI;

            ctx.beginPath();
            ctx.arc(cx, cy, outerR, startAngle, startAngle + sliceAngle);
            ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = proto.color;
            ctx.fill();

            startAngle += sliceAngle;
        }

        // Legend (right side) — uses interpolated ratios for smooth percentage changes
        let ly = 14;
        ctx.textAlign = 'left';
        ctx.font = '10px Inter, sans-serif';
        for (const key of Object.keys(rawData)) {
            const proto = PROTOCOLS[key] || { color: '#71717a', name: key };
            const ratio = this._donutDisplay[key] || 0;
            const pct = Math.round(ratio * 100);

            ctx.fillStyle = proto.color;
            ctx.fillRect(w * 0.7, ly - 6, 8, 8);

            ctx.fillStyle = '#a1a1aa';
            ctx.fillText(`${proto.name} ${pct}%`, w * 0.7 + 14, ly);
            ly += 16;
        }
    }

    // ───────────────────────────────────────────────────
    // Widget: Packet Log (Scrolling Table)
    // ───────────────────────────────────────────────────

    /**
     * Update the scrolling packet log table.
     * Shows the most recent 30 packets.
     * @private
     */
    _updatePacketLog() {
        const container = document.getElementById('packet-log');
        if (!container) return;

        const recent = this.engine.packetLog.slice(-30).reverse();

        let html = '<table class="packet-log-table"><thead><tr>' +
            '<th>Time</th><th>Source</th><th>Dest</th><th>Protocol</th><th>Status</th>' +
            '</tr></thead><tbody>';

        for (const pkt of recent) {
            const time = new Date(pkt.timestamp).toLocaleTimeString();
            const proto = PROTOCOLS[pkt.protocol] || { color: '#71717a', name: pkt.protocol };
            const statusClass = pkt.status === 'arrived' ? 'status-ok' : 'status-flight';

            html += `<tr>
                <td class="log-time">${time}</td>
                <td>${pkt.from}</td>
                <td>${pkt.to}</td>
                <td><span class="log-proto" style="color:${proto.color}">● ${proto.name}</span></td>
                <td><span class="${statusClass}">${pkt.status}</span></td>
            </tr>`;
        }

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    /**
     * Clean up intervals when dashboard is destroyed.
     */
    destroy() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
        }
        if (this._refreshInterval) {
            clearInterval(this._refreshInterval);
        }
    }
}
