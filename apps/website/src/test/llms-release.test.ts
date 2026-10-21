import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import publishedApp from '../data/app-version.json';

const llms = fs.readFileSync(new URL('../../public/llms.txt', import.meta.url), 'utf8');

describe('public LLM release facts', () => {
  it('is generated from the package.json version source', () => {
    expect(publishedApp.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(llms).toContain(`latest published application release is Varve ${publishedApp.version}`);
    expect(llms).toContain('https://github.com/varvedesign/varve');
    expect(llms).toContain('Built in Rust and TypeScript');
    expect(llms).not.toMatch(/Figma|Sketch|Illustrator|Affinity/);
    expect(llms).not.toMatch(/K-Arthur/);
    expect(llms).not.toMatch(/optional AI/);
    expect(llms).not.toMatch(
      /is prepared and in release-candidate validation but is \*\*not published yet\*\*/i,
    );
  });
});
