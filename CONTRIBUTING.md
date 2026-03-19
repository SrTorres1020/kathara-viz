# Contributing to KatharaViz

Thank you for your interest in contributing to KatharaViz, a professional, open-source network topology visualizer for Kathara labs. This guide provides an overview of the development process and standards expected from all contributors.

## Code of Conduct

We expect all contributors to adhere to standard professional etiquette. Treat everyone with respect and focus on technical merit and collaboration. Disrespectful behavior, harassment, or non-constructive communication will not be tolerated.

## Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/KatharaFramework/kathara-viz.git
   cd kathara-viz
   ```

2. **Frontend Environment:**
   No build tools (Webpack, Vite, etc.) are required. 
   Simply serve the root directory over a local web server to support ES6 module loading:
   ```bash
   python -m http.server 8000
   ```
   Access the application at `http://localhost:8000`.

3. **Bridge Server Environment:**
   Ensure Python 3.8+ is installed. Connect to running Kathara instances via Docker metrics.
   ```bash
   pip install docker websockets
   ```
   Start the bridge:
   ```bash
   python bridge/bridge.py --debug
   ```

## Development Guidelines

### JavaScript
- Use native ES6 Modules (`import` / `export`).
- Follow established architectural patterns: strict separation of concerns between core logic (`/src/core`), UI (`/src/ui`), and external integrations.
- Keep the project dependency-free for maximum longevity and minimal maintenance overhead.
- Document complex logic using standard JSDoc comments.
- Avoid introducing arbitrary external frameworks without extensive justification.

### Python
- Follow PEP 8 style guidelines.
- Use the standard `logging` module for all CLI and operational outputs. Do not use emojis, colors or non-standard formatting in operational outputs.
- Ensure efficient resource management, proper thread lifecycle control, and WebSocket context management.

## Testing

KatharaViz uses automated testing to ensure stability across both the frontend and backend. 

### Frontend (JavaScript) Testing
The frontend utilizes [Jest](https://jestjs.io/) to verify core logic (compilers, parsers, and physics math) completely isolated from the browser environment.
To run the frontend tests:
\`\`\`bash
npm install
npm test
\`\`\`

### Backend (Python) Testing
The bridge utilizes [Pytest](https://pytest.org/) to verify packet parsing, shell sessions, and Docker orchestrator behaviors.
To run the backend tests:
\`\`\`bash
cd bridge
pip install -r requirements.txt
python -m pytest tests/
\`\`\`


## Submitting Pull Requests

1. **Branching:** Create a feature branch off `main` (e.g., `feature/live-bridge-optimization`).
2. **Commit Messages:** Follow [Conventional Commits](https://www.conventionalcommits.org/). Start commits with an appropriate type (e.g., `feat:`, `fix:`, `docs:`, `chore:`).
3. **Pull Request:** Describe the problem you are solving, the technical approach taken, and testing instructions. Reference any related issues.
4. **Review Process:** A maintainer will review your code. Ensure all feedback is addressed promptly and professionally.

Thank you for contributing!
