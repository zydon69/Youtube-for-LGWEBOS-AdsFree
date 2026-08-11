import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import pkgJson from '../package.json' with { type: 'json' };

const dependencyTree = JSON.parse(
  execFileSync('pnpm', ['list', '--prod', '--json', '--depth', 'Infinity'], {
    encoding: 'utf8',
    shell: false
  })
)[0];

const components = new Map();

components.set('WICG/spatial-navigation', {
  type: 'library',
  name: 'WICG Spatial Navigation Polyfill',
  version: '183f0146b6741007e46fa64ab0950447defdf8af',
  purl: 'pkg:github/WICG/spatial-navigation@183f0146b6741007e46fa64ab0950447defdf8af',
  licenses: [{ license: { id: 'MIT' } }]
});
components.set('Financial-Times/polyfill-library', {
  type: 'library',
  name: 'Financial Times Polyfill Library DOMRect',
  version: 'c25c30e4463bef60fba1213ecb697f3e3f253d7b',
  purl: 'pkg:github/Financial-Times/polyfill-library@c25c30e4463bef60fba1213ecb697f3e3f253d7b',
  licenses: [{ license: { id: 'MIT' } }]
});

function collectDependencies(dependencies = {}) {
  for (const [name, dependency] of Object.entries(dependencies)) {
    const key = `${name}@${dependency.version}`;
    if (!components.has(key)) {
      const encodedName = name.startsWith('@')
        ? name.slice(1).split('/').map(encodeURIComponent).join('/')
        : encodeURIComponent(name);
      components.set(key, {
        type: 'library',
        name,
        version: dependency.version,
        purl: `pkg:npm/${encodedName}@${dependency.version}`
      });
    }
    collectDependencies(dependency.dependencies);
  }
}

collectDependencies(dependencyTree.dependencies);

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:00000000-0000-4000-8000-${pkgJson.version.replace(/\D/g, '').padEnd(12, '0').slice(0, 12)}`,
  version: 1,
  metadata: {
    component: {
      type: 'application',
      name: pkgJson.name,
      version: pkgJson.version
    }
  },
  components: [...components.values()].sort((left, right) =>
    left.purl.localeCompare(right.purl)
  )
};

await writeFile('sbom.cdx.json', `${JSON.stringify(sbom, null, 2)}\n`);
console.info(`Created sbom.cdx.json with ${components.size} components`);
