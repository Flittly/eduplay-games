
const fs=require('fs'),path=require('path');
const {Resvg}=require('@resvg/resvg-js');
const items=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const out=process.argv[3];
for(const it of items){
  const r=new Resvg(it.svg,{fitTo:{mode:'width',value:512},background:'rgba(0,0,0,0)'});
  fs.writeFileSync(path.join(out,it.key+'.png'), r.render().asPng());
}
console.log('rendered '+items.length);
