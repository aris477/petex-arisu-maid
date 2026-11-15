const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');fs.mkdirSync(path.join(root,'qa'),{recursive:true});
for(const file of ['verify_cling.cjs','verify_four_edges.cjs','verify_timing.cjs','verify_cursor.cjs','verify_stay.cjs','verify_stay_custom.cjs']){
 const r=spawnSync(process.execPath,[path.join(__dirname,file),root],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);
}
console.log('All screen-edge regression checks passed.');
