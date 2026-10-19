import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=path.join(root,'dist');
await fs.mkdir(destination,{recursive:true});
for(const name of ['index.html','styles.css','src','assets','_headers','_routes.json']) {
  await fs.cp(path.join(root,name),path.join(destination,name),{recursive:true});
}
console.log('Static release ready: dist/');
console.log('Includes game, local assets, licenses, headers and API routing.');
console.log('Wrangler deploy compiles functions/ and binds the D1 statistics database.');
