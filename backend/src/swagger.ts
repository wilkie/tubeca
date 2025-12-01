import { writeFileSync } from 'fs';
import { swaggerSpec } from './config/swagger.js';

// Generate openapi.json file
writeFileSync('openapi.json', JSON.stringify(swaggerSpec, null, 2));
console.log('✅ Generated openapi.json');
