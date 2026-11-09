const fs = require(process.versions.electron ? 'original-fs' : 'node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const {validateSprite} = require('./library.cjs');
const MAX_IMAGE = 32 * 1024 * 1024;
const names = {bsod:'BSOD', codex:'Codex', dewey:'Dewey', fireball:'Fireball', hoots:'Hoots', 'null-signal':'Null Signal', rocky:'Rocky', seedy:'Seedy', stacky:'Stacky'};
async function findArchive(selected) {
  const candidates = selected ? [selected, path.join(selected,'Contents/Resources/app.asar'), path.join(selected,'resources/app.asar'), path.join(path.dirname(selected),'resources/app.asar')] : process.platform === 'darwin' ? ['/Applications/ChatGPT.app/Contents/Resources/app.asar','/Applications/Codex.app/Contents/Resources/app.asar', ...['ChatGPT','Codex'].map(name=>path.join(os.homedir(),`Applications/${name}.app/Contents/Resources/app.asar`))] : ['ChatGPT','Codex','codex'].flatMap(name=>[path.join(process.env.LOCALAPPDATA || os.homedir(),'Programs',name,'resources/app.asar'),path.join(process.env.LOCALAPPDATA || os.homedir(),name,'resources/app.asar')]);
  for (const file of candidates) {try {if(path.basename(file)==='app.asar' && (await fsp.stat(file)).isFile())return file;}catch{}}
  return null;
}
async function readBuiltins(archive) {
  const handle = await fsp.open(archive,'r');
  try {
    const size = (await handle.stat()).size;
    async function read(length,offset) {
      if(!Number.isSafeInteger(length)||!Number.isSafeInteger(offset)||length<0||offset<0||offset+length>size)throw new Error('Invalid application archive.');
      const buffer=Buffer.alloc(length);let done=0;
      while(done<length){const r=await handle.read(buffer,done,length-done,offset+done);if(!r.bytesRead)throw new Error('Incomplete application archive.');done+=r.bytesRead;}
      return buffer;
    }
    const prefix=await read(16,0), headerSize=prefix.readUInt32LE(4), jsonSize=prefix.readUInt32LE(12);
    if(prefix.readUInt32LE(0)!==4||headerSize>16*1024*1024||jsonSize>headerSize-8)throw new Error('Invalid application archive.');
    const header=JSON.parse((await read(jsonSize,16)).toString('utf8'));
    const assets=header.files?.webview?.files?.assets?.files || {};
    const pets=[];
    for(const [file,entry] of Object.entries(assets)) {
      const match=/^([a-z0-9-]+)-spritesheet-v\d+-[a-zA-Z0-9_-]+\.(webp|png)$/.exec(file);
      if(!match||entry.link||entry.unpacked||!Number.isSafeInteger(entry.size)||entry.size>MAX_IMAGE)continue;
      const bytes=await read(entry.size,8+headerSize+Number(entry.offset));
      let spriteVersionNumber;
      for(const version of [2,1]){try{await validateSprite(bytes,version);spriteVersionNumber=version;break;}catch{}}
      if(!spriteVersionNumber)continue;
      pets.push({manifest:{displayName:names[match[1]] || match[1].replace(/-/g,' '),description:'Imported from the installed Codex app.',spriteVersionNumber},bytes});
      if(pets.length>=30)break;
    }
    if(!pets.length)throw new Error('No compatible built-in pets found in this app.');
    return pets;
  } finally {await handle.close();}
}
module.exports={findArchive,readBuiltins};
