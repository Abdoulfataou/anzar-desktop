import { describe, expect, it } from 'vitest';
import { isPublicHttpUrl } from './webTools';

describe('isPublicHttpUrl', () => {
  it('accepte les URL publiques http(s)', () => {
    expect(isPublicHttpUrl('https://example.com/docs')).toBe(true);
    expect(isPublicHttpUrl('http://203.0.113.10/')).toBe(true);
  });

  it('refuse loopback, privé, link-local et credentials', () => {
    expect(isPublicHttpUrl('http://localhost:3000')).toBe(false);
    expect(isPublicHttpUrl('http://127.0.0.1/')).toBe(false);
    expect(isPublicHttpUrl('http://10.0.0.1/')).toBe(false);
    expect(isPublicHttpUrl('http://192.168.1.1/')).toBe(false);
    expect(isPublicHttpUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isPublicHttpUrl('https://user:pass@example.com/')).toBe(false);
    expect(isPublicHttpUrl('file:///etc/passwd')).toBe(false);
  });
});
