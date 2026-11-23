import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { assets, readSiteAsset } from '../lib/site-assets.mjs';

const output = new URL('../dist/', import.meta.url);
await mkdir(output, { recursive: true });
for (const name of assets) {
  await writeFile(new URL(name, output), await readSiteAsset(name));
}
await copyFile(new URL('../LICENSE', import.meta.url), new URL('LICENSE', output));
