/**
 * ═══════════════════════════════════════════════════════
 * Animator — SVG Pulse Rendering for Network Simulation
 * ═══════════════════════════════════════════════════════
 * 
 * Renders animated glowing circles ("pulses") that travel
 * along the SVG link lines between devices and collision domains.
 * 
 * Completely decoupled from the simulation engine — it simply
 * receives an array of active packets (with position data) on
 * each tick and draws/updates the corresponding SVG elements.
 * 
 * @module ui/animator
 */

import { svgEl } from '../utils/constants.js';

/**
 * Manages the lifecycle of animated pulse elements on the SVG canvas.
 */
export class Animator {
    /**
     * @param {Object} layout - The computed layout containing nodes and cdNodes
     */
    constructor(layout) {
        /** @type {Object} Reference to the layout for node position lookups */
        this.layout = layout;

        /** @type {Map<number, SVGElement>} Maps packet.id → SVG pulse element */
        this._pulseElements = new Map();

        /** @type {SVGGElement|null} Container group for all pulse animations */
        this._container = null;

        this._initContainer();
    }

    /**
     * Create or find the SVG group that holds all pulse circles.
     * This group is always rendered on top of links but below devices.
     * @private
     */
    _initContainer() {
        const svg = document.getElementById('topology-svg');
        if (!svg) return;

        // Remove existing container if re-initializing
        const existing = svg.querySelector('.pulse-container');
        if (existing) existing.remove();

        this._container = svgEl('g', { class: 'pulse-container' });

        // Insert after links but before devices for proper z-order
        const devicesG = svg.querySelector('.devices');
        if (devicesG) {
            svg.insertBefore(this._container, devicesG);
        } else {
            svg.appendChild(this._container);
        }
    }

    /**
     * Update all pulse positions based on the current active packets.
     * Called every animation frame by the simulation engine's 'tick' event.
     * 
     * @param {Array} activePackets - Array of packet objects with path & progress
     */
    update(activePackets) {
        if (!this._container) return;

        // Track which packet IDs are still active
        const activeIds = new Set();

        for (const pkt of activePackets) {
            activeIds.add(pkt.id);

            // Calculate the current world-space position of this packet
            const pos = this._interpolatePosition(pkt);
            if (!pos) continue;

            // Create or update the pulse SVG element
            let pulse = this._pulseElements.get(pkt.id);
            if (!pulse) {
                pulse = this._createPulse(pkt);
                this._pulseElements.set(pkt.id, pulse);
                this._container.appendChild(pulse);
            }

            // Move to the interpolated position
            pulse.setAttribute('cx', pos.x);
            pulse.setAttribute('cy', pos.y);
        }

        // Remove pulses for packets that have completed their journey
        for (const [id, el] of this._pulseElements) {
            if (!activeIds.has(id)) {
                this._animateRemoval(el);
                this._pulseElements.delete(id);
            }
        }
    }

    /**
     * Create a glowing pulse circle for a new packet.
     * Color is determined by the packet's protocol.
     * 
     * @param {Object} pkt - The packet object
     * @returns {SVGCircleElement}
     * @private
     */
    _createPulse(pkt) {
        const color = pkt.protocol.color || '#10b981';

        const circle = svgEl('circle', {
            r: 6,
            fill: color,
            'fill-opacity': '0.9',
            stroke: color,
            'stroke-width': 3,
            'stroke-opacity': '0.4',
            class: 'pulse-dot',
            'data-packet-id': pkt.id
        });

        // Add a glow filter via inline style for maximum compatibility
        circle.style.filter = `drop-shadow(0 0 6px ${color})`;

        return circle;
    }

    /**
     * Animate a pulse's removal (fade out then delete).
     * @param {SVGCircleElement} el
     * @private
     */
    _animateRemoval(el) {
        el.style.transition = 'opacity 0.3s ease, r 0.3s ease';
        el.style.opacity = '0';
        el.setAttribute('r', '12');
        setTimeout(() => el.remove(), 300);
    }

    /**
     * Calculate the world-space (x, y) position of a packet
     * by interpolating between its current and next path nodes.
     * 
     * @param {Object} pkt - Packet with path, segmentIndex, segmentProgress
     * @returns {{ x: number, y: number }|null}
     * @private
     */
    _interpolatePosition(pkt) {
        const { path, segmentIndex, segmentProgress } = pkt;

        if (segmentIndex >= path.length - 1) return null;

        const fromId = path[segmentIndex];
        const toId = path[segmentIndex + 1];

        const fromPos = this._getNodePosition(fromId);
        const toPos = this._getNodePosition(toId);

        if (!fromPos || !toPos) return null;

        // Linear interpolation (lerp) between segment endpoints
        const t = Math.min(1, Math.max(0, segmentProgress));
        return {
            x: fromPos.x + (toPos.x - fromPos.x) * t,
            y: fromPos.y + (toPos.y - fromPos.y) * t
        };
    }

    /**
     * Look up the current (x, y) position of a node by its ID.
     * Handles both device nodes and collision domain nodes.
     * 
     * @param {string} nodeId - Device name or 'cd_DomainName'
     * @returns {{ x: number, y: number }|null}
     * @private
     */
    _getNodePosition(nodeId) {
        // Check device nodes first
        const device = this.layout.nodes.find(n => n.id === nodeId);
        if (device) return { x: device.x, y: device.y };

        // Check collision domain nodes
        const cdNode = this.layout.cdNodes.find(n => n.id === nodeId);
        if (cdNode) return { x: cdNode.x, y: cdNode.y };

        return null;
    }

    /**
     * Remove all active pulses from the canvas.
     * Called when simulation is stopped.
     */
    clearAll() {
        for (const [, el] of this._pulseElements) {
            el.remove();
        }
        this._pulseElements.clear();
    }

    /**
     * Reinitialize with a new layout (e.g., after topology reload).
     * @param {Object} layout
     */
    setLayout(layout) {
        this.layout = layout;
        this.clearAll();
        this._initContainer();
    }
}
