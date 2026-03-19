/**
 * ═══════════════════════════════════════════════════════
 * SimulationEngine — Core Network Traffic Simulator
 * ═══════════════════════════════════════════════════════
 * 
 * Provides a generic, topology-agnostic simulation engine.
 * Works with ANY parsed Kathara lab by operating purely on the
 * graph structure (devices, collision domains, edges).
 * 
 * Responsibilities:
 *   - Resolving shortest paths between any two devices
 *   - Managing a queue of active packet animations
 *   - Emitting lifecycle events (sent, arrived, dropped)
 *   - Driving the animation tick via requestAnimationFrame
 * 
 * @module core/simulator
 */

/** 
 * Supported protocol types with their visual properties.
 * Each protocol maps to a color used by the animator for pulse rendering.
 */
export const PROTOCOLS = {
    ICMP: { name: 'ICMP', color: '#10b981', label: 'Ping' },
    TCP: { name: 'TCP', color: '#3b82f6', label: 'TCP' },
    UDP: { name: 'UDP', color: '#f59e0b', label: 'UDP' },
    HTTP: { name: 'HTTP', color: '#8b5cf6', label: 'HTTP' },
    DNS: { name: 'DNS', color: '#06b6d4', label: 'DNS' },
    ERROR: { name: 'ERROR', color: '#ef4444', label: 'Error' }
};

/**
 * Unique packet ID counter.
 * Incremented for every packet created during the simulation lifetime.
 */
let packetIdCounter = 0;

export class SimulationEngine {
    /**
     * @param {Object} topology  - The parsed topology from buildTopology()
     * @param {Object} layout    - The computed layout from forceDirectedLayout()
     */
    constructor(topology, layout) {
        /** @type {Object} The parsed network topology */
        this.topology = topology;

        /** @type {Object} The computed node positions */
        this.layout = layout;

        /** @type {Array} Active packets currently being animated */
        this.activePackets = [];

        /** @type {Array} Historical log of all packets (for the dashboard) */
        this.packetLog = [];

        /** @type {boolean} Whether the simulation tick loop is running */
        this.running = false;

        /** @type {number|null} The requestAnimationFrame handle */
        this.rafId = null;

        /** @type {number|null} Auto-traffic interval handle */
        this.autoTrafficInterval = null;

        /** @type {number} Simulation speed multiplier (1.0 = normal) */
        this.speed = 1.0;

        /** @type {Object} Event listeners keyed by event name */
        this._listeners = {};

        /** @type {Object} Adjacency graph for path resolution */
        this._graph = this._buildGraph();

        /** @type {Object} Traffic counters for the dashboard */
        this.stats = {
            totalPackets: 0,
            byProtocol: {},
            packetsPerSecond: [],
            _currentSecondCount: 0,
            _lastSecondTimestamp: Date.now()
        };
    }

    // ───────────────────────────────────────────────────
    // Graph Construction & Path Resolution
    // ───────────────────────────────────────────────────

    /**
     * Build an adjacency graph from the topology.
     * Nodes are devices AND collision domains.
     * Edges connect devices to their collision domains.
     * 
     * This allows BFS to find paths like:
     *   pc1 → LAN_A → r1 → WAN → r2 → LAN_B → pc3
     * 
     * @returns {Object} Adjacency list: { nodeId: [neighborId, ...] }
     * @private
     */
    _buildGraph() {
        const graph = {};

        // Initialize all nodes
        for (const d of this.topology.devices) {
            graph[d.name] = [];
        }
        for (const cd of this.topology.collisionDomains) {
            graph['cd_' + cd.name] = [];
        }

        // Connect devices ↔ collision domains (bidirectional)
        for (const cd of this.topology.collisionDomains) {
            const cdId = 'cd_' + cd.name;
            for (const conn of cd.devices) {
                graph[conn.deviceName].push(cdId);
                graph[cdId].push(conn.deviceName);
            }
        }

        return graph;
    }

    /**
     * Find the shortest path between two device names using BFS.
     * Returns an ordered array of node IDs the packet must traverse.
     * 
     * Example: resolvePath('pc1', 'pc3') might return:
     *   ['pc1', 'cd_LAN_A', 'r1', 'cd_WAN', 'r2', 'cd_LAN_B', 'pc3']
     * 
     * @param {string} from - Source device name
     * @param {string} to   - Destination device name
     * @returns {string[]|null} Ordered path, or null if unreachable
     */
    resolvePath(from, to) {
        if (from === to) return [from];
        if (!this._graph[from] || !this._graph[to]) return null;

        const visited = new Set([from]);
        const queue = [[from]];

        while (queue.length > 0) {
            const path = queue.shift();
            const current = path[path.length - 1];

            for (const neighbor of (this._graph[current] || [])) {
                if (neighbor === to) return [...path, neighbor];
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push([...path, neighbor]);
                }
            }
        }

        return null; // Unreachable
    }

    // ───────────────────────────────────────────────────
    // Packet Creation
    // ───────────────────────────────────────────────────

    /**
     * Simulate a ping (ICMP echo request + reply).
     * Creates two packets: one outbound and one return (delayed).
     * 
     * @param {string} from - Source device name
     * @param {string} to   - Destination device name
     */
    ping(from, to) {
        // Outbound: request
        this.sendPacket(from, to, 'ICMP');

        // Return: reply (delayed by ~half the travel time)
        const path = this.resolvePath(from, to);
        if (path) {
            const delayMs = path.length * 400 / this.speed;
            setTimeout(() => {
                if (this.running) {
                    this.sendPacket(to, from, 'ICMP');
                }
            }, delayMs);
        }
    }

    /**
     * Send a single packet from source to destination.
     * Resolves the path, creates the packet object, and adds it
     * to the active queue for animation.
     * 
     * @param {string} from     - Source device name
     * @param {string} to       - Destination device name
     * @param {string} protocol - Protocol key (ICMP, TCP, UDP, HTTP, DNS)
     * @returns {Object|null} The created packet, or null if path not found
     */
    sendPacket(from, to, protocol = 'TCP') {
        const path = this.resolvePath(from, to);
        if (!path || path.length < 2) {
            this._emit('packetDropped', { from, to, protocol, reason: 'No route' });
            return null;
        }

        const packet = {
            id: ++packetIdCounter,
            from,
            to,
            protocol: PROTOCOLS[protocol] || PROTOCOLS.TCP,
            protocolKey: protocol,
            path,
            segmentIndex: 0,           // Current segment (0 = first hop)
            segmentProgress: 0,        // 0.0 → 1.0 within current segment
            timestamp: Date.now(),
            status: 'in-flight'
        };

        this.activePackets.push(packet);
        this._recordPacket(packet);
        this._emit('packetSent', packet);

        return packet;
    }

    // ───────────────────────────────────────────────────
    // Auto Traffic Generator
    // ───────────────────────────────────────────────────

    /**
     * Start generating random traffic between hosts at regular intervals.
     * Only sends packets between host-type devices (not routers/switches).
     * 
     * @param {number} intervalMs - Milliseconds between random packets
     */
    startAutoTraffic(intervalMs = 2000) {
        this.stopAutoTraffic();

        const hosts = this.topology.devices.filter(d => d.type === 'host');
        if (hosts.length < 2) return;

        const protocols = ['ICMP', 'TCP', 'UDP', 'HTTP', 'DNS'];

        this.autoTrafficInterval = setInterval(() => {
            if (!this.running) return;

            // Pick two random distinct hosts
            const srcIdx = Math.floor(Math.random() * hosts.length);
            let dstIdx = Math.floor(Math.random() * hosts.length);
            while (dstIdx === srcIdx) {
                dstIdx = Math.floor(Math.random() * hosts.length);
            }

            const protocol = protocols[Math.floor(Math.random() * protocols.length)];
            const src = hosts[srcIdx].name;
            const dst = hosts[dstIdx].name;

            if (protocol === 'ICMP') {
                this.ping(src, dst);
            } else {
                this.sendPacket(src, dst, protocol);
            }
        }, intervalMs);
    }

    /**
     * Stop the auto-traffic generator.
     */
    stopAutoTraffic() {
        if (this.autoTrafficInterval) {
            clearInterval(this.autoTrafficInterval);
            this.autoTrafficInterval = null;
        }
    }

    // ───────────────────────────────────────────────────
    // Simulation Tick Loop
    // ───────────────────────────────────────────────────

    /**
     * Start the simulation animation loop.
     * Uses requestAnimationFrame for smooth 60fps rendering.
     */
    start() {
        if (this.running) return;
        this.running = true;
        this._lastFrameTime = performance.now();
        this._tick();
        this._emit('started');
    }

    /**
     * Pause the simulation (keeps packets in their current positions).
     */
    pause() {
        this.running = false;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this._emit('paused');
    }

    /**
     * Stop the simulation entirely and clear all active packets.
     */
    stop() {
        this.pause();
        this.stopAutoTraffic();
        this.activePackets = [];
        this._emit('stopped');
    }

    /**
     * Core animation tick. Advances all active packets along their paths.
     * Called every frame via requestAnimationFrame.
     * 
     * @private
     */
    _tick() {
        if (!this.running) return;

        const now = performance.now();
        const dt = (now - this._lastFrameTime) / 1000; // Delta in seconds
        this._lastFrameTime = now;

        // Speed of travel: segments per second (higher = faster pulses)
        const segmentsPerSecond = 1.5 * this.speed;

        // Advance each active packet
        for (let i = this.activePackets.length - 1; i >= 0; i--) {
            const pkt = this.activePackets[i];

            pkt.segmentProgress += segmentsPerSecond * dt;

            // Move to the next path segment if progress exceeds 1.0
            while (pkt.segmentProgress >= 1.0 && pkt.segmentIndex < pkt.path.length - 2) {
                pkt.segmentProgress -= 1.0;
                pkt.segmentIndex++;
            }

            // Packet arrived at destination
            if (pkt.segmentIndex >= pkt.path.length - 2 && pkt.segmentProgress >= 1.0) {
                pkt.status = 'arrived';
                this.activePackets.splice(i, 1);
                this._emit('packetArrived', pkt);
            }
        }

        // Emit tick so the animator can redraw pulse positions
        this._emit('tick', this.activePackets);

        // Update packets-per-second counter for dashboard
        this._updatePPS();

        this.rafId = requestAnimationFrame(() => this._tick());
    }

    // ───────────────────────────────────────────────────
    // Statistics & Event System
    // ───────────────────────────────────────────────────

    /**
     * Record a packet in the statistics and log.
     * @param {Object} packet
     * @private
     */
    _recordPacket(packet) {
        this.stats.totalPackets++;
        const key = packet.protocolKey;
        this.stats.byProtocol[key] = (this.stats.byProtocol[key] || 0) + 1;
        this.stats._currentSecondCount++;

        this.packetLog.push({
            id: packet.id,
            timestamp: packet.timestamp,
            from: packet.from,
            to: packet.to,
            protocol: packet.protocolKey,
            status: packet.status
        });

        // Cap log at 200 entries to prevent memory bloat
        if (this.packetLog.length > 200) {
            this.packetLog.shift();
        }
    }

    /**
     * Track packets-per-second for the dashboard timeline chart.
     * Samples once per second and stores the last 60 data points.
     * @private
     */
    _updatePPS() {
        const now = Date.now();
        if (now - this.stats._lastSecondTimestamp >= 1000) {
            this.stats.packetsPerSecond.push(this.stats._currentSecondCount);
            this.stats._currentSecondCount = 0;
            this.stats._lastSecondTimestamp = now;

            // Keep only the last 60 seconds
            if (this.stats.packetsPerSecond.length > 60) {
                this.stats.packetsPerSecond.shift();
            }
        }
    }

    /**
     * Subscribe to a simulation event.
     * 
     * Events: 'packetSent', 'packetArrived', 'packetDropped',
     *         'tick', 'started', 'paused', 'stopped'
     * 
     * @param {string}   event    - Event name
     * @param {Function} callback - Handler function
     */
    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);
    }

    /**
     * Emit an event to all registered listeners.
     * @param {string} event
     * @param {*}      data
     * @private
     */
    _emit(event, data) {
        for (const cb of (this._listeners[event] || [])) {
            cb(data);
        }
    }
}
