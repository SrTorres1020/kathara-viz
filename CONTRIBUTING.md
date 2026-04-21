# Contributing to KatharaViz

Thank you for your interest in contributing to KatharaViz. This guide provides an overview of the development process and standards expected from all contributors.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Development Setup](#development-setup)
  - [Prerequisites](#prerequisites)
  - [Frontend Environment](#frontend-environment)
  - [Bridge Server Environment](#bridge-server-environment)
- [Development Guidelines](#development-guidelines)
  - [JavaScript](#javascript)
  - [Python](#python)
- [Testing](#testing)
  - [Frontend Testing](#frontend-testing)
  - [Backend Testing](#backend-testing)
- [Submitting Pull Requests](#submitting-pull-requests)
- [Reporting Issues](#reporting-issues)

---

## Code of Conduct

We expect all contributors to adhere to professional etiquette. Treat everyone with respect and focus on technical merit and collaboration. Disrespectful behavior, harassment, or non-constructive communication will not be tolerated.

---

## Development Setup

### Prerequisites

- Git installed on your system
- Python 3.8+ for the backend bridge
- Node.js and npm for frontend testing (optional)
- Docker installed and running (for live capture functionality)

### Clone the Repository

```bash
git clone https://github.com/SrTorres1020/kathara-viz.git
cd kathara-viz
```

### Frontend Environment

No build tools (Webpack, Vite, etc.) are required. Simply serve the root directory over a local web server to support ES6 module loading:

```bash
# Serve via Python
python -m http.server 8000

# Or serve via Node.js
npx http-server -p 8000
```

Access the application at `http://localhost:8000`.

### Bridge Server Environment

```bash
# Install Python dependencies
pip install docker websockets

# Start the bridge server with debug output
python bridge/bridge.py --debug
```

---

## Development Guidelines

### JavaScript

| Rule | Description |
|------|-------------|
| **Modules** | Use native ES6 Modules (`import` / `export`). |
| **Architecture** | Maintain strict separation of concerns: core logic (`/src/core`), UI (`/src/ui`), and external integrations. |
| **Dependencies** | Keep the project dependency-free for maximum longevity and minimal maintenance overhead. |
| **Documentation** | Document complex logic using standard JSDoc comments. |
| **Frameworks** | Avoid introducing arbitrary external frameworks without extensive justification. |

### Python

| Rule | Description |
|------|-------------|
| **Style** | Follow PEP 8 style guidelines. |
| **Logging** | Use the standard `logging` module for all CLI and operational outputs. Do not use emojis, colors, or non-standard formatting in operational outputs. |
| **Resources** | Ensure efficient resource management, proper thread lifecycle control, and WebSocket context management. |

---

## Testing

KatharaViz uses automated testing to ensure stability across both the frontend and backend.

### Frontend Testing

The frontend utilizes [Jest](https://jestjs.io/) to verify core logic (compilers, parsers, and physics math) completely isolated from the browser environment.

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm test -- --coverage
```

### Backend Testing

The bridge utilizes [Pytest](https://pytest.org/) to verify packet parsing, shell sessions, and Docker orchestrator behaviors.

```bash
# Navigate to bridge directory
cd bridge

# Install dependencies
pip install -r requirements.txt

# Run tests
python -m pytest tests/

# Run tests with verbose output
python -m pytest tests/ -v
```

---

## Submitting Pull Requests

### Branching Strategy

Create a feature branch off `main`:

```bash
git checkout -b feature/your-feature-name
```

Examples:
- `feature/websocket-reconnection`
- `fix/memory-leak-terminal`
- `docs/update-readme`

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

| Type | Description |
|------|-------------|
| `feat:` | A new feature |
| `fix:` | A bug fix |
| `docs:` | Documentation only changes |
| `style:` | Changes that do not affect the meaning of the code |
| `refactor:` | Code change that neither fixes a bug nor adds a feature |
| `test:` | Adding missing tests or correcting existing tests |
| `chore:` | Changes to the build process or auxiliary tools |

Examples:

```bash
git commit -m "feat: Add WebSocket reconnection with exponential backoff"
git commit -m "fix: Resolve memory leak in TerminalManager"
git commit -m "docs: Update README with troubleshooting section"
```

### Pull Request Checklist

Before submitting a pull request, ensure:

- [ ] Code follows the development guidelines
- [ ] Tests pass for both frontend and backend
- [ ] Documentation is updated if applicable
- [ ] Commit messages follow Conventional Commits
- [ ] Related issues are referenced (e.g., "Closes #123")

### Pull Request Description

Include the following information:

1. **Summary** - Brief description of the changes
2. **Problem** - The issue being addressed
3. **Solution** - Technical approach taken
4. **Testing** - How the changes were tested
5. **Screenshots** - If UI changes were made (optional)

---

## Reporting Issues

When reporting issues, please include:

- **Environment** - Operating system, Python version, browser version
- **Steps to Reproduce** - Clear, numbered steps
- **Expected Behavior** - What should happen
- **Actual Behavior** - What actually happens
- **Logs** - Relevant error messages or stack traces

---

Thank you for contributing to KatharaViz!
</parameter>