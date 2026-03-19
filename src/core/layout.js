export function forceDirectedLayout(topology, width, height) {
    const nodes = [];
    const cdNodes = [];

    // Place devices
    topology.devices.forEach((d, i) => {
        const angle = (2 * Math.PI * i) / topology.devices.length;
        const radius = Math.min(width, height) * 0.28;
        nodes.push({
            id: d.name,
            type: 'device',
            x: width / 2 + radius * Math.cos(angle),
            y: height / 2 + radius * Math.sin(angle),
            vx: 0, vy: 0,
            data: d
        });
    });

    // Place collision domains at center of their connected devices
    topology.collisionDomains.forEach(cd => {
        const connected = nodes.filter(n => cd.devices.some(d => d.deviceName === n.id));
        let cx = width / 2, cy = height / 2;
        if (connected.length > 0) {
            cx = connected.reduce((s, n) => s + n.x, 0) / connected.length;
            cy = connected.reduce((s, n) => s + n.y, 0) / connected.length;
        }
        cdNodes.push({ id: 'cd_' + cd.name, type: 'domain', x: cx, y: cy, vx: 0, vy: 0, data: cd });
    });

    const allNodes = [...nodes, ...cdNodes];

    // Build edges: device ↔ collision domain
    const edges = [];
    topology.collisionDomains.forEach(cd => {
        cd.devices.forEach(conn => {
            edges.push({
                source: conn.deviceName,
                target: 'cd_' + cd.name,
                iface: conn.iface
            });
        });
    });

    // Simulate
    const iterations = 300;
    const repulsion = 8000;
    const attraction = 0.005;
    const damping = 0.9;
    const minDist = 120;

    for (let iter = 0; iter < iterations; iter++) {
        const temp = 1 - iter / iterations;

        for (let i = 0; i < allNodes.length; i++) {
            for (let j = i + 1; j < allNodes.length; j++) {
                const a = allNodes[i], b = allNodes[j];
                let dx = a.x - b.x, dy = a.y - b.y;
                let dist = Math.sqrt(dx * dx + dy * dy) || 1;
                if (dist < minDist) dist = minDist;
                const force = (repulsion * temp) / (dist * dist);
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;
                a.vx += fx; a.vy += fy;
                b.vx -= fx; b.vy -= fy;
            }
        }

        for (const e of edges) {
            const a = allNodes.find(n => n.id === e.source);
            const b = allNodes.find(n => n.id === e.target);
            if (!a || !b) continue;
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = attraction * dist * temp;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.vx += fx; a.vy += fy;
            b.vx -= fx; b.vy -= fy;
        }

        for (const n of allNodes) {
            n.vx += (width / 2 - n.x) * 0.001;
            n.vy += (height / 2 - n.y) * 0.001;
        }

        for (const n of allNodes) {
            n.vx *= damping;
            n.vy *= damping;
            n.x += n.vx;
            n.y += n.vy;
            n.x = Math.max(80, Math.min(width - 80, n.x));
            n.y = Math.max(80, Math.min(height - 80, n.y));
        }
    }

    return { nodes, cdNodes, edges };
}
