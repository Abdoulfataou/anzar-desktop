import { describe, expect, it } from 'vitest';
import { sanitizeMermaid } from './VisualBlock';

describe('sanitizeMermaid', () => {
  it('retire scripts, gestionnaires et foreignObject', () => {
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><div>X</div></foreignObject><a onclick="alert(2)">lien</a><rect width="10" height="10"/></svg>';
    const clean = sanitizeMermaid(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('foreignObject');
    expect(clean).not.toContain('onclick');
    expect(clean).toContain('<rect');
  });
});
