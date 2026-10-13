// O manifesto e o JavaScript usam a mesma identidade, calculada no build/servidor local.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
async function widgetRelease(capturePath=path.join(root,'central-bugs-capture.js')) {
  const source=await fs.readFile(path.join(root,'central-bugs.js'),'utf8');
  let capture=Buffer.alloc(0);
  try { capture=await fs.readFile(capturePath); } catch(error) { if(error.code!=='ENOENT')throw error; }
  const release=createHash('sha256').update(source).update(capture).digest('hex');
  return {code:source.replace('__CENTRAL_BUGS_RELEASE__',release),manifest:{protocol:1,release}};
}
module.exports={widgetRelease};
