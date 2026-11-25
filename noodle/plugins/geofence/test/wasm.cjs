const createPlugin = require('@extism/extism');
const fs = require('node:fs');
(async()=>{
 const state={};let adds=0;
 const p=await createPlugin({wasm:[{data:new Uint8Array(fs.readFileSync('dist/plugin.wasm'))}]},{useWasi:true,runInWorker:true,functions:{'extism:host/user':{httpRequest(cp,off){
  const {args:[url,opts]}=cp.read(off).json();let body;
  if(url.includes('/assets/') && url.endsWith('/metadata')){
   if(opts.method==='GET') body=state[url]?[{key:'noodle-geofence-v1',value:state[url]}]:[];
   else {state[url]=JSON.parse(opts.body).items[0].value;body=[];}
  }else if(url.endsWith('/tags'))body=[{id:'source',value:'Standortquelle/Test'}];
  else if(url.includes('/albums?assetId='))body=[];
  else if(url.endsWith('/albums'))body=[{id:'album',albumName:'!Test',albumUsers:[{user:{id:'owner'}}]}];
  else if(url.endsWith('/search/metadata'))body={assets:{items:[{id:'seed',type:'IMAGE',exifInfo:{latitude:48,longitude:16}}],nextCursor:null}};
  else if(url.endsWith('/assets')){adds++;body=[{id:'new',success:true}];}
  else throw Error(url);
  return cp.store(JSON.stringify({success:true,response:{status:200,body:JSON.stringify(body)}}));
 }}}});
 const payload={trigger:'AssetMetadataExtraction',type:'AssetV1',workflow:{authToken:'mock'},config:{apiUrl:'https://photos.quickme.at/api',apiKey:'mock',ownerId:'owner',sourceTags:{album:'source'},enabledAfter:'2026-10-01T00:00:00Z'},data:{asset:{id:'new',type:'IMAGE',ownerId:'owner',createdAt:'2026-10-30T00:00:00Z',exifInfo:{latitude:48.001,longitude:16}}}};
 for(let i=0;i<2;i++){const out=await p.call('sortUpload',JSON.stringify(payload));if(out.text()!=='{}')throw Error('unexpected output');}
 if(adds!==1)throw Error('expected one addition, got '+adds);
 await p.close();console.log('WASM host integration passed: one addition, no reprocessing');
})().catch(e=>{console.error(e);process.exitCode=1;});
