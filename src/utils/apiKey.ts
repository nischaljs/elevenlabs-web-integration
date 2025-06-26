import crypto from 'crypto';

export function generateApiKey(): string {
  // 24 bytes = 32 chars in base64url
  return 'sk-' + crypto.randomBytes(24).toString('base64url');
}


export function generateApiKeys(count: number): string[] {
  return Array.from({ length: count }, () => generateApiKey());
}

if (require.main === module) {
  // Print 4 API keys if run directly
  console.log(generateApiKeys(4).join('\n'));
} 