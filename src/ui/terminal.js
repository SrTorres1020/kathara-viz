/**
 * KatharaViz Terminal Manager
 *
 * Provides an embedded web terminal connected to live Kathara Docker
 * containers via the bridge WebSocket. Each terminal tab corresponds
 * to one interactive shell session inside a container.
 *
 * Dependencies:
 *   - xterm.js (loaded via CDN in index.html)
 *   - xterm-addon-fit (loaded via CDN in index.html)
 */

/* global Terminal, FitAddon */

export class TerminalManager {
    /**
     * @param {WebSocket|null} ws - Reference to the bridge WebSocket
     */
    constructor(ws = null) {
        this._ws = ws;
        /** @type {Map<string, {term: Terminal, fitAddon: FitAddon, device: string, tabEl: HTMLElement}>} */
        this._sessions = new Map();
        this._activeSession = null;
        this._panel = document.getElementById('terminal-panel');
        this._tabBar = document.getElementById('terminal-tabs');
        this._termContainer = document.getElementById('terminal-container');
        this._visible = false;

        // Bind resize observer
        this._resizeObserver = new ResizeObserver(() => this._fitActive());
        if (this._termContainer) {
            this._resizeObserver.observe(this._termContainer);
        }

        // Listen for window resize
        window.addEventListener('resize', () => this._fitActive());
    }

    /** Update WebSocket reference (called when bridge connects/disconnects). */
    setWebSocket(ws) {
        this._ws = ws;
    }

    /** Handle incoming WebSocket messages from the bridge. */
    handleMessage(msg) {
        switch (msg.type) {
            case 'shell_open_ok':
                this._onSessionOpened(msg.session, msg.device);
                break;
            case 'shell_output':
                this._onSessionOutput(msg.session, msg.data);
                break;
            case 'shell_exit':
                this._onSessionExit(msg.session);
                break;
            case 'shell_error':
                console.error('[Terminal]', msg.error);
                break;
        }
    }

    /**
     * Request opening a terminal for a specific device.
     * @param {string} deviceName
     */
    open(deviceName) {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
            console.warn('[Terminal] Bridge WebSocket is not connected.');
            return;
        }

        // If already have a session for this device, just focus it
        for (const [sid, info] of this._sessions) {
            if (info.device === deviceName) {
                this._activateTab(sid);
                return;
            }
        }

        const cols = Math.floor((this._termContainer?.clientWidth || 600) / 9);
        const rows = Math.floor((this._termContainer?.clientHeight || 300) / 18);

        this._ws.send(JSON.stringify({
            type: 'shell_open',
            device: deviceName,
            cols: Math.max(cols, 40),
            rows: Math.max(rows, 10)
        }));
    }

    /** Close a specific terminal session. */
    close(sessionId) {
        const info = this._sessions.get(sessionId);
        if (!info) return;

        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify({ type: 'shell_close', session: sessionId }));
        }

        info.term.dispose();
        info.tabEl.remove();
        this._sessions.delete(sessionId);

        // If no sessions left, hide the panel
        if (this._sessions.size === 0) {
            this.hide();
            this._activeSession = null;
        } else if (this._activeSession === sessionId) {
            // Activate the next remaining session
            const nextId = this._sessions.keys().next().value;
            this._activateTab(nextId);
        }
    }

    /** Close all active terminal sessions. */
    closeAll() {
        for (const sid of [...this._sessions.keys()]) {
            this.close(sid);
        }
    }

    /** Show the terminal panel. */
    show() {
        if (this._panel) {
            this._panel.classList.add('visible');
            this._visible = true;
            setTimeout(() => this._fitActive(), 50);
        }
    }

    /** Hide the terminal panel. */
    hide() {
        if (this._panel) {
            this._panel.classList.remove('visible');
            this._visible = false;
        }
    }

    /** Toggle panel visibility. */
    toggle() {
        if (this._visible) this.hide();
        else this.show();
    }

    /** @returns {boolean} Whether the terminal panel is visible */
    get isVisible() {
        return this._visible;
    }

    // ── Private Methods ──────────────────────────────

    _onSessionOpened(sessionId, deviceName) {
        // Create xterm instance
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            theme: {
                background: '#0c0c14',
                foreground: '#e4e4ef',
                cursor: '#a78bfa',
                selectionBackground: 'rgba(167, 139, 250, 0.3)',
                black: '#1a1a2e',
                red: '#f87171',
                green: '#4ade80',
                yellow: '#facc15',
                blue: '#60a5fa',
                magenta: '#c084fc',
                cyan: '#22d3ee',
                white: '#e4e4ef',
                brightBlack: '#4a4a6a',
                brightRed: '#fca5a5',
                brightGreen: '#86efac',
                brightYellow: '#fde68a',
                brightBlue: '#93c5fd',
                brightMagenta: '#d8b4fe',
                brightCyan: '#67e8f9',
                brightWhite: '#ffffff'
            },
            allowTransparency: true,
            scrollback: 5000
        });

        const fitAddon = new FitAddon.FitAddon();
        term.loadAddon(fitAddon);

        // Create tab element
        const tabEl = document.createElement('div');
        tabEl.className = 'terminal-tab';
        tabEl.dataset.session = sessionId;
        tabEl.innerHTML = `
            <span class="terminal-tab-name">${deviceName}</span>
            <button class="terminal-tab-close" title="Close terminal">&times;</button>
        `;
        tabEl.querySelector('.terminal-tab-name').addEventListener('click', () => {
            this._activateTab(sessionId);
        });
        tabEl.querySelector('.terminal-tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.close(sessionId);
        });
        this._tabBar.appendChild(tabEl);

        // Store session
        this._sessions.set(sessionId, { term, fitAddon, device: deviceName, tabEl });

        // Show panel and activate this tab
        this.show();
        this._activateTab(sessionId);

        // Wire input to WebSocket
        term.onData((data) => {
            if (this._ws && this._ws.readyState === WebSocket.OPEN) {
                this._ws.send(JSON.stringify({
                    type: 'shell_input',
                    session: sessionId,
                    data: data
                }));
            }
        });
    }

    _onSessionOutput(sessionId, data) {
        const info = this._sessions.get(sessionId);
        if (info) {
            info.term.write(data);
        }
    }

    _onSessionExit(sessionId) {
        const info = this._sessions.get(sessionId);
        if (info) {
            info.term.writeln('\r\n\x1b[90m[Session terminated]\x1b[0m');
        }
    }

    _activateTab(sessionId) {
        const info = this._sessions.get(sessionId);
        if (!info) return;

        // Deactivate current
        if (this._activeSession && this._activeSession !== sessionId) {
            const prev = this._sessions.get(this._activeSession);
            if (prev) {
                prev.tabEl.classList.remove('active');
                prev.term.element?.parentNode?.removeChild(prev.term.element);
            }
        }

        // Clear container and open new terminal
        this._termContainer.innerHTML = '';
        info.term.open(this._termContainer);
        info.fitAddon.fit();
        info.term.focus();
        info.tabEl.classList.add('active');
        this._activeSession = sessionId;

        // Mark all tabs
        this._tabBar.querySelectorAll('.terminal-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.session === sessionId);
        });
    }

    _fitActive() {
        if (!this._activeSession) return;
        const info = this._sessions.get(this._activeSession);
        if (info) {
            try {
                info.fitAddon.fit();
            } catch {
                // Terminal may not be mounted yet
            }
        }
    }
}
