/**
 * ═══════════════════════════════════════════════════════
 * LiveBridge — WebSocket Client for Real Traffic Capture
 * ═══════════════════════════════════════════════════════
 * 
 * Connects KatharaViz to the bridge server (bridge.py) via
 * WebSocket and injects real packet events into the simulation
 * pipeline. Works with ANY Kathara lab — no modification needed.
 * 
 * Flow:
 *   bridge.py (tcpdump → parse → WS:9000)
 *       → LiveBridge.js (receive → map IPs → inject)
 *           → SimulationEngine (animate + dashboard)
 * 
 * @module core/live-bridge
 */

export class LiveBridge {
    /**
     * @param {Object} topology     - Parsed topology (devices, collisionDomains)
     * @param {Object} simEngine    - SimulationEngine instance to inject packets into
     */
    constructor(topology, simEngine) {
        /** @type {Object} */
        this.topology = topology;

        /** @type {Object} */
        this.engine = simEngine;

        /** @type {WebSocket|null} */
        this._ws = null;

        /** @type {boolean} */
        this.connected = false;

        /** @type {string} */
        this.status = 'disconnected'; // disconnected | connecting | connected | error

        /** @type {number|null} */
        this._reconnectTimer = null;

        /** @type {Map<string, string>} IP → device name mapping */
        this._ipMap = this._buildIpMap();

        /** @type {Array<string>} Live container names from bridge */
        this.liveContainers = [];

        /** @type {Function|null} Status change callback */
        this.onStatusChange = null;

        /** @type {Function|null} Callback for terminal messages */
        this.terminalMessageHandler = null;

        /** @type {number} Packets received from bridge */
        this.packetsReceived = 0;
    }

    // ───────────────────────────────────────────────────
    // IP → Device Mapping
    // ───────────────────────────────────────────────────

    /**
     * Build a map from IP addresses to device names using
     * the parsed topology data (from *.startup files).
     * 
     * Example: { "192.168.1.11": "pc1", "10.0.0.1": "r1" }
     * 
     * @returns {Map<string, string>}
     * @private
     */
    _buildIpMap() {
        const map = new Map();

        for (const device of this.topology.devices) {
            // Check IPs parsed from startup files
            if (device.interfaces) {
                for (const iface of device.interfaces) {
                    if (iface.ip) {
                        // Strip CIDR notation: "192.168.1.11/24" → "192.168.1.11"
                        const ip = iface.ip.split('/')[0];
                        map.set(ip, device.name);
                    }
                }
            }

            // Also check the ips array if available
            if (device.ips) {
                for (const ip of device.ips) {
                    const cleanIp = ip.split('/')[0];
                    map.set(cleanIp, device.name);
                }
            }
        }

        console.log(`[LiveBridge] IP map built: ${map.size} entries`, Object.fromEntries(map));
        return map;
    }

    /**
     * Resolve an IP address to a device name.
     * Falls back to the container name from the bridge if no IP match.
     * 
     * @param {string} ip - IP address
     * @param {string} containerName - Container name from bridge
     * @returns {string|null} Device name or null
     */
    _resolveDevice(ip, containerName) {
        // Try IP mapping first (most accurate)
        if (this._ipMap.has(ip)) {
            return this._ipMap.get(ip);
        }

        // Fall back: try matching the container name to a device name
        const device = this.topology.devices.find(d =>
            d.name === containerName ||
            d.name.toLowerCase() === containerName.toLowerCase()
        );
        if (device) return device.name;

        return null;
    }

    // ───────────────────────────────────────────────────
    // Connection Management
    // ───────────────────────────────────────────────────

    /**
     * Connect to the bridge server via WebSocket.
     * 
     * @param {string} url - WebSocket URL (default: ws://localhost:9000)
     */
    connect(url = 'ws://localhost:9000') {
        if (this._ws) this.disconnect();

        this._setStatus('connecting');
        console.log(`[LiveBridge] Connecting to ${url}...`);

        try {
            this._ws = new WebSocket(url);
        } catch (e) {
            this._setStatus('error');
            return;
        }

        this._ws.onopen = () => {
            console.log('[LiveBridge] Connected to bridge server');
            this._setStatus('connected');
            this.connected = true;

            // Ensure simulation is running when live
            if (!this.engine.running) {
                this.engine.start();
            }
        };

        this._ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this._handleMessage(msg);
            } catch (e) {
                console.warn('[LiveBridge] Invalid message:', e);
            }
        };

        this._ws.onclose = () => {
            console.log('[LiveBridge] Disconnected');
            this.connected = false;
            this._setStatus('disconnected');

            // Auto-reconnect after 3 seconds
            this._reconnectTimer = setTimeout(() => {
                if (this.status !== 'disconnected') return;
                console.log('[LiveBridge] Attempting reconnect...');
                this.connect(url);
            }, 3000);
        };

        this._ws.onerror = () => {
            this._setStatus('error');
        };
    }

    /**
     * Disconnect from the bridge server.
     */
    disconnect() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        if (this._ws) {
            this._ws.onclose = null; // Prevent auto-reconnect
            this._ws.close();
            this._ws = null;
        }

        this.connected = false;
        this._setStatus('disconnected');
    }

    /**
     * Update status and notify listeners.
     * @param {string} status
     * @private
     */
    _setStatus(status) {
        this.status = status;
        if (this.onStatusChange) this.onStatusChange(status);
    }

    // ───────────────────────────────────────────────────
    // Message Handling
    // ───────────────────────────────────────────────────

    /**
     * Process a message from the bridge server.
     * @param {Object} msg
     * @private
     */
    _handleMessage(msg) {
        // Route terminal-related messages to the TerminalManager
        if (msg.type && msg.type.startsWith('shell_')) {
            if (this.terminalMessageHandler) {
                this.terminalMessageHandler(msg);
            }
            return;
        }

        if (msg.type === 'batch') {
            for (const pkt of msg.packets) {
                if (pkt.type === 'packet') {
                    this._injectPacket(pkt);
                } else if (pkt.type === 'containers') {
                    this.liveContainers = pkt.list;
                }
            }
        } else if (msg.type === 'containers') {
            this.liveContainers = msg.list;
        } else if (msg.type === 'packet') {
            this._injectPacket(msg);
        }
    }

    /**
     * Returns the underlying WebSocket instance for direct messaging.
     * @returns {WebSocket|null}
     */
    getWebSocket() {
        return this._ws;
    }

    /**
     * Inject a real packet into the simulation engine.
     * Maps the source and destination IPs to device names
     * and triggers a visual animation.
     * 
     * @param {Object} pkt - Parsed packet from bridge
     * @private
     */
    _injectPacket(pkt) {
        const srcDevice = this._resolveDevice(pkt.src, pkt.container);
        const dstDevice = this._resolveDevice(pkt.dst, pkt.container);

        if (!srcDevice || !dstDevice) return; // Can't map both endpoints
        if (srcDevice === dstDevice) return;   // Skip loopback

        this.packetsReceived++;

        // Map protocol string to engine protocol key
        const protoKey = this._mapProtocol(pkt.proto);

        // Inject into the simulation engine (creates animation + dashboard entry)
        this.engine.sendPacket(srcDevice, dstDevice, protoKey);
    }

    /**
     * Map a bridge protocol string to a SimulationEngine protocol key.
     * @param {string} proto
     * @returns {string}
     * @private
     */
    _mapProtocol(proto) {
        const upper = (proto || '').toUpperCase();
        if (upper === 'ICMP') return 'ICMP';
        if (upper === 'UDP') return 'UDP';
        if (upper === 'HTTP') return 'HTTP';
        if (upper === 'DNS') return 'DNS';
        return 'TCP';
    }
}
