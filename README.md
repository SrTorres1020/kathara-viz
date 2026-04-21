# KatharaViz

A professional, modular network topology visualizer and simulation engine for [Kathara](https://www.kathara.org/) laboratories.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-orange)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue)](https://www.python.org/)

---

## Table of Contents

- [Overview](#overview)
- [Key Capabilities](#key-capabilities)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
  - [Visualization and Simulation (Frontend)](#1-visualization-and-simulation-frontend)
  - [Live Capture (Backend Bridge)](#2-live-capture-backend-bridge)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

KatharaViz enables network engineers, educators, and students to visualize complex Kathara network configurations without manual diagramming. The tool automatically:

- Parses Kathara configuration files (`lab.conf`, `*.startup`)
- Infers collision domains and network topology
- Auto-arranges devices using a physics-based layout engine
- Enables real-time packet monitoring via live Docker integration

Built with vanilla JavaScript and ES6 modules, KatharaViz requires zero build processes, prioritizing long-term maintainability and performance over transient framework dependencies.

---

## Key Capabilities

| Feature | Description |
|---------|-------------|
| **Intelligent Auto-Parsing** | Ingests `lab.conf` and `*.startup` to extract topologies, IP configurations, default gateways, and collision domains. |
| **Force-Directed Graph Engine** | Custom physics simulation to logically organize network maps, separating internal LAN segments from transit links. |
| **Component Abstraction** | Distinguishes host machines, Layer 2 switches, and Layer 3 routers dynamically. |
| **Live Network Capture Bridge** | Attaches to running Kathara Docker containers, executing `tcpdump` and streaming packet data over WebSockets. |
| **Zero-Dependency Frontend** | Operates exclusively on standard web technologies without external package dependencies. |

---

## Architecture

KatharaViz is divided into two primary subsystems:

### Frontend Web Application

A client-side application responsible for:
- Parsing and rendering network topologies
- Simulating packet animations
- Providing interactive UI controls

### Backend Live Bridge

A Python-based server that:
- Discovers running Kathara Docker containers
- Executes `tcpdump` inside containers
- Parses packet data and streams events via WebSocket

### Communication Flow

```
Kathara Containers (Docker)
         |
         v
   bridge.py (tcpdump + WebSocket:9000)
         |
         v
   LiveBridge.js (WebSocket client)
         |
         v
   SimulationEngine (packet animation)
         |
         v
   SVG Renderer (visual output)
```

---

## Project Structure

```text
kathara-viz/
|
|-- bridge/
|   |-- bridge.py          # Python backend for live capture and WebSocket streaming
|   |-- tests/
|   |   |-- __init__.py
|   |   |-- test_parser.py  # Python unit tests
|   |-- requirements.txt   # Python dependencies
|   |-- .flake8            # Python linting configuration
|
|-- examples/
|   |-- simple/            # Basic topology example
|   |-- complex/           # Multi-router topology example
|
|-- src/
|   |-- core/              # Business logic
|   |   |-- parser.js      # Lab configuration parser
|   |   |-- simulator.js   # Network traffic simulation engine
|   |   |-- layout.js      # Force-directed graph layout algorithm
|   |   |-- live-bridge.js # WebSocket client for live capture
|   |
|   |-- ui/                # View layer components
|   |   |-- renderer.js    # SVG topology renderer
|   |   |-- sidebar.js    # Device list and details panel
|   |   |-- animator.js    # Packet pulse animations
|   |   |-- dashboard.js  # Statistics and charts panel
|   |   |-- terminal.js   # xterm.js integration for shell access
|   |
|   |-- utils/             # Shared utilities
|   |   |-- constants.js  # Colors, icons, and helper functions
|   |
|   |-- css/
|   |   |-- styles.css    # Application styling
|   |
|   |-- icons/             # Device SVG icons
|   |   |-- router.svg
|   |   |-- switch.svg
|   |   |-- host.svg
|   |   |-- domain.svg
|   |
|   |-- tests/
|       |-- parser.test.js # JavaScript unit tests
|
|-- index.html              # Web application entry point
|-- CONTRIBUTING.md        # Development standards and guidelines
|-- LICENSE                # MIT License
```

---

## Quick Start

### 1. Visualization and Simulation (Frontend)

The application relies on native ES6 modules. Browsers block local file module execution via the `file://` protocol for security reasons. A simple HTTP server is required.

**Requirements:** Python 3.x or Node.js installed.

```bash
# Clone the repository
git clone https://github.com/SrTorres1020/kathara-viz.git
cd kathara-viz

# Serve via Python
python -m http.server 8000

# Or serve via Node.js (if npx is available)
npx http-server -p 8000
```

Open your browser to `http://localhost:8000`. Drag and drop any Kathara lab folder into the drop zone.

### 2. Live Capture (Backend Bridge)

To monitor live packets visually, the Bridge server must be running alongside an active Kathara lab.

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

Within the KatharaViz web UI (with the lab already loaded), click **Go Live** in the top navigation bar to establish the WebSocket connection. Packet transitions will animate across the topology in real-time.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| **Docker Permissions Denied** | Ensure the user running `bridge.py` has Docker daemon permissions. Add the user to the `docker` group: `sudo usermod -aG docker $USER` |
| **WebSocket Port Binding Failed** | The bridge defaults to `localhost:9000`. Check for port conflicts: `lsof -i :9000`. Terminate conflicting processes or modify `WS_PORT` in `bridge.py`. |
| **No Live Packets Detected** | Verify Kathara containers are running: `docker ps | grep kathara`. Ensure containers have the `app=kathara` label. |
| **Topology Not Rendering** | Confirm `lab.conf` exists in the dropped folder. Check browser console for parser errors. |

For verbose diagnostics, run the bridge with the `--debug` flag:

```bash
python bridge/bridge.py --debug
```

---

## Contributing

Please review the [Contributing Guidelines](CONTRIBUTING.md) before submitting pull requests. We maintain professional standards for code quality and documentation, including mandatory test coverage for business logic.

---

## License

KatharaViz is distributed under the [MIT License](LICENSE).

---

## Acknowledgments

- [Kathara Framework](https://www.kathara.org/) - The network emulation platform that inspired this project
- Contributors and open-source maintainers of Docker, WebSockets, and xterm.js
</parameter>