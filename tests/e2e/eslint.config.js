import base from '@blue/config/eslint';

export default [...base, { ignores: ['.artifacts/**', 'playwright-report/**', 'test-results/**'] }];
