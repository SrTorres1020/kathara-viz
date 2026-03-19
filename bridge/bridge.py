#!/usr/bin/env python3
"""
KatharaViz Bridge Server

A generic, self-contained bridge that connects KatharaViz
to real Kathara Docker containers for live traffic monitoring.

How it works:
  1. Auto-discovers running Kathara containers via Docker API
  2. Runs `tcpdump` inside each container via `docker exec`
  3. Parses tcpdump output into structured packet events
  4. Streams events over WebSocket (port 9000) to the browser

Usage:
  pip install docker websockets
  python bridge.py [--debug]

No lab modification required.
"""

import argparse
import asyncio
import json
import logging
import os
import re
import subprocess
import sys
import threading
import uuid
import time

# Setup logging
logger = logging.getLogger("KatharaBridge")

try:
    import docker
except ImportError:
    logger.critical("Missing dependency: docker. Install with: pip install docker")
    sys.exit(1)

try:
    import websockets

    try:
        from websockets.asyncio.server import serve as ws_serve
    except ImportError:
        # websockets v12 and below
        ws_serve = websockets.serve
except ImportError:
    logger.critical(
        "Missing dependency: websockets. Install with: pip install websockets"
    )
    sys.exit(1)


# ─── Configuration ───────────────────────────────────

WS_PORT = 9000
POLL_INTERVAL = 5  # Seconds between container re-discovery
TCPDUMP_CMD = ["tcpdump", "-l", "-n", "-i", "any", "-tt", "-U"]

# ─── Global State ────────────────────────────────────

connected_clients = set()
active_captures = {}  # container_id -> subprocess thread
container_names = {}  # container_id -> device_name
packet_buffer = []  # Thread-safe buffer for parsed packets
buffer_lock = threading.Lock()

# Shell session state
shell_sessions = {}  # session_id -> {proc, device, container_id, websocket, thread}
shell_lock = threading.Lock()


# ─── tcpdump Line Parser ────────────────────────────

# Matches tcpdump output in LINUX_SLL2 format (when using -i any):
#   1772172544.818086 eth0  Out IP 10.0.1.10 > 10.0.2.10: ICMP echo request, id 3, seq 421, length 64
#   1772172543.819383 eth0  P   IP 10.0.1.10 > 10.0.2.10: ICMP echo request, id 3, seq 420, length 64
# Also matches standard format (without -i any):
#   1709000000.123456 IP 192.168.1.11.54321 > 192.168.1.100.80: Flags [S]
TCPDUMP_PATTERN = re.compile(
    r"^(\d+\.\d+)\s+"  # timestamp
    r"(?:\S+\s+)?"  # optional interface (eth0, eth1, lo, etc.)
    r"(?:(?:In|Out|P|B)\s+)?"  # optional direction (In, Out, P=pass, B=broadcast)
    r"(?:IP6?\s+)?"  # optional IP/IP6 prefix
    r"(\d+\.\d+\.\d+\.\d+)"  # source IP
    r"(?:\.\d+)?"  # optional source port
    r"\s+>\s+"  # direction arrow
    r"(\d+\.\d+\.\d+\.\d+)"  # destination IP
    r"(?:\.\d+)?"  # optional dest port
    r":\s*(.*)"  # rest of the line (protocol info)
)

ICMP_PATTERN = re.compile(r"ICMP", re.IGNORECASE)
UDP_PATTERN = re.compile(r"UDP|\.53\b", re.IGNORECASE)
HTTP_PATTERN = re.compile(r"\.80\b|\.8080\b|\.443\b|HTTP", re.IGNORECASE)
DNS_PATTERN = re.compile(r"\.53[\s:]|domain", re.IGNORECASE)
LENGTH_PATTERN = re.compile(r"length\s+(\d+)")


def classify_protocol(line):
    """Classify a tcpdump line into a protocol category."""
    if ICMP_PATTERN.search(line):
        return "ICMP"
    if DNS_PATTERN.search(line):
        return "DNS"
    if HTTP_PATTERN.search(line):
        return "HTTP"
    if UDP_PATTERN.search(line):
        return "UDP"
    return "TCP"


def parse_tcpdump_line(line, container_name):
    """Parse a single tcpdump output line into a structured event."""
    match = TCPDUMP_PATTERN.match(line.strip())
    if not match:
        return None

    ts_str, src_ip, dst_ip, info = match.groups()
    protocol = classify_protocol(info)

    # Extract packet length if available
    length_match = LENGTH_PATTERN.search(info)
    pkt_bytes = int(length_match.group(1)) if length_match else 64

    return {
        "type": "packet",
        "container": container_name,
        "src": src_ip,
        "dst": dst_ip,
        "proto": protocol,
        "bytes": pkt_bytes,
        "ts": float(ts_str),
    }


# ─── Container Discovery & Capture ──────────────────


def discover_kathara_containers(client):
    """Find all running Kathara containers using Docker labels and name patterns."""
    containers = []

    # Strategy 1: Kathara labels its containers with 'app=kathara'
    try:
        found = client.containers.list(filters={"label": "app=kathara"})
        if found:
            return found
    except Exception:
        pass

    # Strategy 2: Try name-based filtering (kathara prefix)
    try:
        all_containers = client.containers.list()
        containers = [c for c in all_containers if (c.name or "").startswith("kathara")]
        if containers:
            return containers
    except Exception:
        pass

    # Strategy 3: Check all containers for Kathara-related labels
    try:
        all_containers = client.containers.list()
        for c in all_containers:
            labels = c.labels or {}
            # Kathara may use various label keys
            if any(
                k.startswith("kathara") or v == "kathara" for k, v in labels.items()
            ):
                containers.append(c)
        if containers:
            return containers
    except Exception:
        pass

    # Strategy 4: Last resort - return all containers and let user filter
    try:
        return client.containers.list()
    except Exception:
        return []


def extract_device_name(container):
    """
    Extract the Kathara device name from a Docker container.
    """
    # Strategy 1: Read from Docker labels (most reliable)
    labels = container.labels or {}
    for label_key in ["name", "device", "kathara.name", "com.kathara.name"]:
        if label_key in labels:
            return labels[label_key]

    # Strategy 2: Parse from container name
    name = container.name or container.short_id
    for separator in ["_", "-"]:
        parts = name.split(separator)
        if len(parts) >= 4 and parts[0].lower() == "kathara":
            return parts[-1]
        if len(parts) >= 3 and parts[0].lower() == "kathara":
            return parts[-1]

    # Strategy 3: If name starts with 'kathara', take everything after the hash
    if "kathara" in name.lower():
        for sep in ["_", "-"]:
            if sep in name:
                return name.rsplit(sep, 1)[-1]

    # Fallback: use the container name itself
    return name


def capture_container(container_id, device_name, docker_client):
    """Run tcpdump inside a container and parse its output."""
    logger.info(f"Capturing traffic on {device_name} ({container_id[:12]})")

    try:
        cmd = ["docker", "exec", container_id] + TCPDUMP_CMD
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1
        )
        active_captures[container_id] = proc

        # Log any stderr in a separate thread
        def log_stderr():
            for err_line in proc.stderr:
                err_line = err_line.strip()
                if err_line and "listening on" in err_line.lower():
                    logger.debug(f"tcpdump active on {device_name}: {err_line}")
                elif err_line and "packets captured" not in err_line:
                    logger.warning(f"tcpdump stderr for {device_name}: {err_line}")

        stderr_thread = threading.Thread(target=log_stderr, daemon=True)
        stderr_thread.start()

        pkt_count = 0
        for line in proc.stdout:
            if container_id not in active_captures:
                break

            if pkt_count < 3:
                logger.debug(f"[{device_name}] Raw capture: {line.strip()[:120]}")

            parsed = parse_tcpdump_line(line, device_name)
            if parsed:
                pkt_count += 1
                if pkt_count <= 3:
                    logger.debug(
                        f"[{device_name}] Parsed: {parsed['proto']} {parsed['src']} -> {parsed['dst']}"
                    )
                elif pkt_count == 4:
                    logger.debug(
                        f"[{device_name}] Suppressing further debug logs; streaming active."
                    )

                with buffer_lock:
                    packet_buffer.append(parsed)
            elif pkt_count < 3:
                logger.debug(
                    f"[{device_name}] Regex failed to match: {line.strip()[:120]}"
                )

    except Exception as e:
        logger.error(f"Capture operational error on {device_name}: {e}")
    finally:
        active_captures.pop(container_id, None)
        logger.info(f"Terminated capture for {device_name}")


def discovery_loop(docker_client):
    """Periodically discover new Kathara containers and start captures."""
    logger.info("Initializing container discovery routine.")
    first_run = True

    while True:
        try:
            containers = discover_kathara_containers(docker_client)
            current_ids = set()

            if first_run and containers:
                logger.info(f"Discovered {len(containers)} Kathara containers.")
                for c in containers:
                    labels = c.labels or {}
                    logger.debug(
                        f"Container properties: name={c.name}, id={c.short_id}, labels={dict(labels)}"
                    )
                first_run = False

            for c in containers:
                cid = c.id
                current_ids.add(cid)

                if cid not in active_captures:
                    device_name = extract_device_name(c)
                    container_names[cid] = device_name
                    logger.info(
                        f"Mapped container {c.name} to logical device {device_name}"
                    )

                    # Broadcast updated container list
                    with buffer_lock:
                        packet_buffer.append(
                            {
                                "type": "containers",
                                "list": list(container_names.values()),
                            }
                        )

                    # Start capture thread
                    t = threading.Thread(
                        target=capture_container,
                        args=(cid, device_name, docker_client),
                        daemon=True,
                    )
                    t.start()

            # Clean up containers that no longer exist
            for old_id in list(active_captures.keys()):
                if old_id not in current_ids:
                    proc = active_captures.pop(old_id, None)
                    if proc:
                        proc.terminate()
                    container_names.pop(old_id, None)

        except Exception as e:
            logger.error(f"Container discovery subroutine encountered an error: {e}")

        time.sleep(POLL_INTERVAL)


# ─── Shell Session Management ────────────────────────


def resolve_container_id(device_name):
    """Resolve a device name to its Docker container ID."""
    for cid, name in container_names.items():
        if name == device_name:
            return cid
    return None


def shell_reader_thread(session_id, proc, loop, websocket):
    """Background thread that reads shell stdout and enqueues messages to the event loop."""
    try:
        while True:
            data = proc.stdout.read(4096)
            if not data:
                break
            payload = json.dumps(
                {
                    "type": "shell_output",
                    "session": session_id,
                    "data": data.decode("utf-8", errors="replace"),
                }
            )
            asyncio.run_coroutine_threadsafe(websocket.send(payload), loop)
    except Exception as e:
        logger.debug(f"Shell reader for session {session_id[:8]} terminated: {e}")
    finally:
        # Notify client that the shell has exited
        exit_payload = json.dumps({"type": "shell_exit", "session": session_id})
        try:
            asyncio.run_coroutine_threadsafe(websocket.send(exit_payload), loop)
        except Exception:
            pass
        with shell_lock:
            shell_sessions.pop(session_id, None)
        logger.info(f"Shell session {session_id[:8]} ended.")


async def handle_shell_open(websocket, data, loop):
    """Open an interactive shell session in a container."""
    device_name = data.get("device")
    if not device_name:
        await websocket.send(
            json.dumps({"type": "shell_error", "error": "Missing device name."})
        )
        return

    container_id = resolve_container_id(device_name)
    if not container_id:
        await websocket.send(
            json.dumps(
                {
                    "type": "shell_error",
                    "error": f"No active container found for device '{device_name}'.",
                }
            )
        )
        return

    session_id = str(uuid.uuid4())
    cols = data.get("cols", 80)
    rows = data.get("rows", 24)

    try:
        env = os.environ.copy()
        env["COLUMNS"] = str(cols)
        env["LINES"] = str(rows)
        env["TERM"] = "xterm-256color"

        # Use 'script' to allocate a pseudo-TTY inside the container.
        # Without a PTY, bash won't echo input or display a prompt.
        proc = subprocess.Popen(
            [
                "docker",
                "exec",
                "-i",
                "-e",
                "TERM=xterm-256color",
                "-e",
                f"COLUMNS={cols}",
                "-e",
                f"LINES={rows}",
                container_id,
                "script",
                "-qc",
                "/bin/bash",
                "/dev/null",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=0,
        )

        reader = threading.Thread(
            target=shell_reader_thread,
            args=(session_id, proc, loop, websocket),
            daemon=True,
        )
        reader.start()

        with shell_lock:
            shell_sessions[session_id] = {
                "proc": proc,
                "device": device_name,
                "container_id": container_id,
                "websocket": websocket,
                "thread": reader,
            }

        logger.info(
            f"Shell session {session_id[:8]} opened for {device_name} ({container_id[:12]})."
        )
        await websocket.send(
            json.dumps(
                {"type": "shell_open_ok", "session": session_id, "device": device_name}
            )
        )

    except Exception as e:
        logger.error(f"Failed to open shell for {device_name}: {e}")
        await websocket.send(json.dumps({"type": "shell_error", "error": str(e)}))


async def handle_shell_input(data):
    """Write user input to an active shell session."""
    session_id = data.get("session")
    input_data = data.get("data", "")
    with shell_lock:
        session = shell_sessions.get(session_id)
    if not session:
        return
    try:
        session["proc"].stdin.write(input_data.encode("utf-8"))
        session["proc"].stdin.flush()
    except Exception as e:
        logger.debug(f"Shell input write error for session {session_id[:8]}: {e}")


async def handle_shell_close(data):
    """Close an active shell session."""
    session_id = data.get("session")
    with shell_lock:
        session = shell_sessions.pop(session_id, None)
    if session:
        try:
            session["proc"].terminate()
        except Exception:
            pass
        logger.info(f"Shell session {session_id[:8]} closed by client.")


def cleanup_sessions_for_client(websocket):
    """Terminate all shell sessions belonging to a disconnected client."""
    sessions_to_remove = []
    with shell_lock:
        for sid, session in shell_sessions.items():
            if session["websocket"] is websocket:
                sessions_to_remove.append(sid)
    for sid in sessions_to_remove:
        with shell_lock:
            session = shell_sessions.pop(sid, None)
        if session:
            try:
                session["proc"].terminate()
            except Exception:
                pass
            logger.info(f"Shell session {sid[:8]} cleaned up after client disconnect.")


# ─── WebSocket Server ────────────────────────────────


async def ws_handler(websocket):
    """Handle a WebSocket client connection and route messages."""
    connected_clients.add(websocket)
    remote = websocket.remote_address
    loop = asyncio.get_event_loop()
    logger.info(f"Client connected from {remote}")

    if container_names:
        await websocket.send(
            json.dumps({"type": "containers", "list": list(container_names.values())})
        )

    try:
        async for raw_message in websocket:
            try:
                msg = json.loads(raw_message)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")
            if msg_type == "shell_open":
                await handle_shell_open(websocket, msg, loop)
            elif msg_type == "shell_input":
                await handle_shell_input(msg)
            elif msg_type == "shell_close":
                await handle_shell_close(msg)

    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        logger.error(f"WebSocket client error ({remote}): {e}")
    finally:
        cleanup_sessions_for_client(websocket)
        connected_clients.discard(websocket)
        logger.info(f"Client disconnected: {remote}")


async def broadcast_loop():
    """Flush the packet buffer and broadcast to all connected clients."""
    while True:
        await asyncio.sleep(0.05)  # 20 Hz broadcast rate

        with buffer_lock:
            if not packet_buffer or not connected_clients:
                packet_buffer.clear()
                continue
            batch = list(packet_buffer)
            packet_buffer.clear()

        message = json.dumps({"type": "batch", "packets": batch})
        disconnected = set()
        for ws in connected_clients:
            try:
                await ws.send(message)
            except Exception:
                disconnected.add(ws)
        connected_clients.difference_update(disconnected)


async def main():
    """Main application lifecycle management."""
    parser = argparse.ArgumentParser(description="KatharaViz Live Bridge Server")
    parser.add_argument(
        "--debug", action="store_true", help="Enable verbose debug logging"
    )
    args = parser.parse_args()

    # Configure logging level
    log_level = logging.DEBUG if args.debug else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    logger.info("Initializing KatharaViz Bridge Server...")

    try:
        docker_client = docker.from_env()
        docker_client.ping()
        logger.info("Docker daemon connection established successfully.")
    except Exception as e:
        logger.critical(f"Failed to connect to the Docker daemon: {e}")
        logger.critical(
            "Ensure Docker is executing and accessible in the present context."
        )
        sys.exit(1)

    # Dispatch discovery worker
    discovery_thread = threading.Thread(
        target=discovery_loop, args=(docker_client,), daemon=True
    )
    discovery_thread.start()

    # Dispatch core broadcast worker
    asyncio.create_task(broadcast_loop())

    # Initialize WebSocket listener
    try:
        logger.info(
            f"Binding WebSocket listener on IPv4 localhost interface (Port {WS_PORT})."
        )
        await websockets.serve(ws_handler, "127.0.0.1", WS_PORT)
        logger.info(f"WebSocket server actively listening on ws://127.0.0.1:{WS_PORT}")
    except Exception as e:
        logger.critical(f"Failed to bind WebSocket server on port {WS_PORT}: {e}")
        sys.exit(1)

    await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Interrupt received. Terminating bridge server.")
        sys.exit(0)
