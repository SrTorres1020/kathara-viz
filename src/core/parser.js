export function parseLabConf(text) {
    const devices = {};
    const metadata = {};
    const lines = text.split('\n');

    for (const raw of lines) {
        const line = raw.trim().replace(/\r$/, '');
        if (!line || line.startsWith('#')) continue;

        const metaMatch = line.match(/^(\w+)\s*=\s*"?(.+?)"?\s*$/);
        if (metaMatch && metaMatch[1].startsWith('LAB_')) {
            metadata[metaMatch[1]] = metaMatch[2];
            continue;
        }

        const match = line.match(/^(\w[\w-]*)?\[(\w+)\]\s*=\s*"?([^"]*)"?\s*$/);
        if (!match) continue;

        const [, deviceName, arg, value] = match;
        if (!devices[deviceName]) {
            devices[deviceName] = { name: deviceName, interfaces: [], options: {}, startupCmds: [] };
        }

        const ifIndex = parseInt(arg, 10);
        if (!isNaN(ifIndex)) {
            const parts = value.split('/');
            const cd = parts[0].trim();
            const mac = parts[1] ? parts[1].trim() : null;
            devices[deviceName].interfaces.push({
                index: ifIndex, collisionDomain: cd, ip: null, netmask: null, mac: mac
            });
        } else {
            devices[deviceName].options[arg] = value;
        }
    }

    return { devices, metadata };
}

export function parseStartup(deviceName, text) {
    const result = { ips: {}, gateway: null, commands: [] };
    const lines = text.split('\n');

    for (const raw of lines) {
        const line = raw.trim().replace(/\r$/, '');
        if (!line || line.startsWith('#')) continue;
        result.commands.push(line);

        const ipMatch = line.match(/ip\s+addr\s+add\s+([\d.]+)\/([\d]+)\s+dev\s+eth(\d+)/);
        if (ipMatch) {
            result.ips[parseInt(ipMatch[3], 10)] = { ip: ipMatch[1], mask: ipMatch[2] };
            continue;
        }

        const ifcMatch = line.match(/ifconfig\s+eth(\d+)\s+([\d.]+)\s+netmask\s+([\d.]+)/);
        if (ifcMatch) {
            result.ips[parseInt(ifcMatch[1], 10)] = { ip: ifcMatch[2], mask: ifcMatch[3] };
            continue;
        }

        const ifcMatch2 = line.match(/ifconfig\s+eth(\d+)\s+([\d.]+)\/([\d]+)/);
        if (ifcMatch2) {
            result.ips[parseInt(ifcMatch2[1], 10)] = { ip: ifcMatch2[2], mask: ifcMatch2[3] };
            continue;
        }

        const gwMatch = line.match(/ip\s+route\s+add\s+default\s+via\s+([\d.]+)/);
        if (gwMatch) {
            result.gateway = gwMatch[1];
            continue;
        }

        const gwMatch2 = line.match(/route\s+add\s+default\s+gw\s+([\d.]+)/);
        if (gwMatch2) {
            result.gateway = gwMatch2[1];
        }
    }

    return result;
}

export function detectDeviceType(device) {
    const name = device.name.toLowerCase();
    if (name.startsWith('sw') || name.startsWith('switch')) return 'switch';

    const img = (device.options.image || '').toLowerCase();
    if (img.includes('frr') || img.includes('quagga') || img.includes('bird')) return 'router';

    if (device.interfaces.length >= 2) {
        const domains = new Set(device.interfaces.map(i => i.collisionDomain));
        if (domains.size >= 2) return 'router';
    }

    if (name.startsWith('r') || name.startsWith('router') || name.startsWith('gw')) return 'router';

    return 'host';
}

export function buildTopology(files) {
    const labContent = files['lab.conf'];
    if (!labContent) return null;

    const { devices, metadata } = parseLabConf(labContent);
    const collisionDomains = {};

    for (const [filename, content] of Object.entries(files)) {
        if (!filename.endsWith('.startup')) continue;
        const deviceName = filename.replace('.startup', '');
        if (!devices[deviceName]) continue;

        const startup = parseStartup(deviceName, content);
        devices[deviceName].startupCmds = startup.commands;
        devices[deviceName].gateway = startup.gateway;

        for (const iface of devices[deviceName].interfaces) {
            const ipInfo = startup.ips[iface.index];
            if (ipInfo) {
                iface.ip = ipInfo.ip;
                iface.netmask = ipInfo.mask;
            }
        }
    }

    for (const d of Object.values(devices)) {
        d.type = detectDeviceType(d);
    }

    for (const d of Object.values(devices)) {
        for (const iface of d.interfaces) {
            const cd = iface.collisionDomain;
            if (!collisionDomains[cd]) {
                collisionDomains[cd] = { name: cd, devices: [], subnet: null };
            }
            collisionDomains[cd].devices.push({ deviceName: d.name, iface });
        }
    }

    for (const cd of Object.values(collisionDomains)) {
        const ips = cd.devices.map(d => d.iface.ip).filter(Boolean);
        if (ips.length > 0) {
            const first = ips[0];
            const mask = cd.devices.find(d => d.iface.ip)?.iface.netmask;
            const parts = first.split('.').slice(0, 3).join('.');
            cd.subnet = mask ? `${parts}.0/${mask}` : `${parts}.0/24`;
        }
    }

    return {
        devices: Object.values(devices),
        collisionDomains: Object.values(collisionDomains),
        metadata
    };
}
