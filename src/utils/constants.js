export const COLORS = {
    router: { fill: '#1e3a5f', stroke: '#3b82f6', text: '#60a5fa' },
    switch: { fill: '#78350f', stroke: '#f59e0b', text: '#fbbf24' },
    host: { fill: '#064e3b', stroke: '#10b981', text: '#34d399' },
    domain: { fill: '#27272a', stroke: '#71717a', text: '#a1a1aa' }
};

export const ICONS = {
    router: '',
    switch: '',
    host: '',
    domain: ''
};

export async function loadIcons() {
    const names = ['router', 'switch', 'host', 'domain'];
    for (const name of names) {
        try {
            // Added ?t=Date.now() to prevent browser caching during development
            const res = await fetch(`./src/icons/${name}.svg?t=${Date.now()}`);
            if (res.ok) {
                const text = await res.text();
                // Extract inner tags so we can inject them easily to be colored by currentColor 
                const match = text.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
                if (match) {
                    ICONS[name] = match[1];
                }
            }
        } catch (e) {
            console.error(`Failed to load icon ${name}:`, e);
        }
    }
}

export function svgEl(tag, attrs = {}, children = '') {
    const ns = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v);
    }
    if (typeof children === 'string') {
        el.innerHTML = children;
    } else if (children instanceof Node) {
        el.appendChild(children);
    }
    return el;
}

export function svgPoint(evt, svgElement) {
    const pt = svgElement.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svgElement.getScreenCTM().inverse());
}
