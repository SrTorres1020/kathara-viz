import { parseLabConf, detectDeviceType } from '../core/parser.js';

describe('Parser Core Logic', () => {

    describe('parseLabConf', () => {
        it('should correctly parse a standard lab.conf', () => {
            const labConfText = `
LAB_NAME="Test Lab"
LAB_DESCRIPTION="A simple test lab"

pc1[0]=A
pc2[0]=A
router1[0]=A
router1[1]=B
router1[image]="kathara/frr"
`.trim();

            const result = parseLabConf(labConfText);

            // Check Metadata
            expect(result.metadata.LAB_NAME).toBe('Test Lab');
            expect(result.metadata.LAB_DESCRIPTION).toBe('A simple test lab');

            // Check Devices
            expect(Object.keys(result.devices)).toHaveLength(3);
            expect(result.devices['pc1'].interfaces).toHaveLength(1);
            expect(result.devices['pc1'].interfaces[0].collisionDomain).toBe('A');

            expect(result.devices['router1'].interfaces).toHaveLength(2);
            expect(result.devices['router1'].options.image).toBe('kathara/frr');
        });

        it('should ignore comments and empty lines', () => {
            const labConfText = `
# This is a comment
pc1[0]=A

# Another comment
pc2[0]=B
`.trim();

            const result = parseLabConf(labConfText);
            expect(Object.keys(result.devices)).toHaveLength(2);
        });
    });

    describe('detectDeviceType', () => {
        it('should detect switches based on name', () => {
            expect(detectDeviceType({ name: 'sw1', options: {}, interfaces: [] })).toBe('switch');
            expect(detectDeviceType({ name: 'switch_core', options: {}, interfaces: [] })).toBe('switch');
        });

        it('should detect routers based on image', () => {
            expect(detectDeviceType({ name: 'node1', options: { image: 'kathara/frr' }, interfaces: [] })).toBe('router');
            expect(detectDeviceType({ name: 'node2', options: { image: 'kathara/quagga' }, interfaces: [] })).toBe('router');
        });

        it('should detect routers based on multiple collision domains', () => {
            const device = {
                name: 'node1',
                options: {},
                interfaces: [
                    { collisionDomain: 'A' },
                    { collisionDomain: 'B' }
                ]
            };
            expect(detectDeviceType(device)).toBe('router');
        });

        it('should fallback to host', () => {
            const device = {
                name: 'pc1',
                options: {},
                interfaces: [
                    { collisionDomain: 'A' },
                    { collisionDomain: 'A' } // Same CD = probably not routing
                ]
            };
            expect(detectDeviceType(device)).toBe('host');
        });
    });
});
