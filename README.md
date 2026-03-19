# KatharaViz

A professional, modular network topology visualizer and simulation engine for [Kathara](https://www.kathara.org/) laboratories.

## Overview

KatharaViz enables network engineers, educators, and students to seamlessly visualize complex Kathara network configurations without manual diagramming. The tool automatically parses Kathara configuration files, infers collision domains, auto-arranges devices utilizing an embedded physics engine, and enables real-time packet monitoring via live Docker integration.

Built strictly with vanilla JavaScript and ES6 modules, KatharaViz requires zero build processes. It prioritizes long-term maintainability and performance over transient framework dependencies.

## Key Capabilities

* **Intelligent Auto-Parsing:** Ingests `lab.conf` and `*.startup` to extract topologies, IP configurations, default gateways, and collision domains.
* **Force-Directed Graph Engine:** Leverages a custom physics simulation to logically organize network maps, cleanly separating internal LAN segments from transit links.
* **Component Abstraction:** Distinguishes host machines, Layer 2 switches, and Layer 3 routers dynamically.
* **Live Network Capture Bridge:** Directly attaches to running Kathara Docker containers, executing `tcpdump` and streaming packet data over WebSockets directly into the visualization.
* **Zero-Dependency Frontend Architecture:** Operates exclusively on standard web technologies without external package bloat.

## Architecture

KatharaViz is divided into two primary subsystems: the Frontend Web Application and the Backend Live Bridge.

### Project Structure

```text
kathara-viz/
├── bridge/
│   └── bridge.py       # Python backend for Live Capture mapping and WebSocket streaming
├── examples/           # Preconfigured Kathara topologies for testing
├── src/
│   ├── core/           # Business logic: Parser, Physics Layout, Simulation Engine
│   ├── css/            # UI aesthetics, utilizing CSS variables for theme consistency
│   ├── ui/             # View layer: Canvas Renderer, Sidebar, and HUD logic
│   └── utils/          # Constants and shared utility functions
├── index.html          # Web Application entry point
├── CONTRIBUTING.md     # Development standards and guidelines
└── README.md
```

## Quick Start

### 1. Visualization & Simulation (Frontend Only)

To visualize labs locally, the application relies on native ES6 modules. Browsers block local file module execution via the `file://` protocol for security reasons. A simple HTTP server is required.

**Requirements:** Python 3.x or Node.js.

```bash
# Clone the repository
git clone https://github.com/KatharaFramework/kathara-viz.git
cd kathara-viz

# Serve via Python
python -m http.server 8000
```

Open your browser to `http://localhost:8000`. Drag and drop any Kathara lab folder into the drop zone.

### 2. Live Capture (Backend Bridge)

To monitor live packets visually transitioning across the network map, the Bridge server must be initiated alongside an active Kathara lab.

**Requirements:** Python 3.8+, Docker installed and running.

```bash
# Install bridge dependencies
pip install docker websockets

# Start your target Kathara lab
cd path/to/kathara-lab
kathara lstart

# Start the KatharaViz Bridge server
cd kathara-viz
python bridge/bridge.py
```

Within the KatharaViz web UI (with the lab already loaded), click **"Go Live"** in the top navigation bar to establish the WebSocket connection. Packet transitions will animate across the topology in real-time.

## Troubleshooting

* **Docker Permissions:** Ensure the user running `bridge.py` has appropriate Docker daemon permissions.
* **WebSocket Port Binding:** The bridge defaults to parsing traffic over `localhost:9000` via IPv4. Look for port conflicts if the server fails to bind. Execute with the `--debug` flag for verbose diagnostics:
  ```bash
  python bridge/bridge.py --debug
  ```

## Contributing

Please review the [Contributing Guidelines](CONTRIBUTING.md) before submitting pull requests. We maintain strict professional standards for code quality and documentation, including mandatory test coverage for business logic in both Python and JavaScript.
## License

KatharaViz is distributed under the [MIT License](LICENSE).
