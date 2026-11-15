import './style.css';
import JsBarcode from 'jsbarcode';
import { requestPrinter, fromUSBDevice } from '@thermal-label/labelwriter-web';
import { MEDIA } from '@thermal-label/labelwriter-core';

// DYMO 30336: 54 mm across printer head, 25 mm feed direction, @ 300 dpi.
const W = 638, H = 295;
const els = Object.fromEntries(['name','price','qty','sku','brand','connect','print','status','png','labelCanvas'].map(id=>[id,document.getElementById(id)]));
const ctx = els.labelCanvas.getContext('2d',{willReadFrequently:true});
// Square's CSV is loaded only into this browser tab. No Square credentials or write access.
const sq = Object.fromEntries(['squareFile','squareStatus','squareSearch','squareItem','useSquare'].map(id=>[id,document.getElementById(id)]));
let squareRows = [], visibleSquareRows = [];
const showSquareStatus = message => {sq.squareStatus.textContent=message;};
// RFC 4180-style CSV parser: handles quoted commas, escaped quotes and embedded newlines.
function parseCsv(text){
 const rows=[]; let fields=[], field='', quoted=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')quoted=false;else field+=ch;}
  else if(ch==='"'&&field==='')quoted=true;
  else if(ch===','){fields.push(field);field='';}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;fields.push(field);field='';if(fields.some(v=>v.trim()))rows.push(fields);fields=[];}
  else field+=ch;
 }
 if(quoted)throw new Error('CSV has an unfinished quoted field.');
 fields.push(field);if(fields.some(v=>v.trim()))rows.push(fields);
 return rows;
}
function parseSquareCsv(text){
 const rows=parseCsv(text);
 const clean=s=>String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
 // Some Square templates contain instruction rows; locate the real table header.
 const headIndex=rows.findIndex(r=>r.some(v=>clean(v)==='item name')&&r.some(v=>clean(v)==='sku'));
 if(headIndex<0)throw new Error('Could not find Square columns "Item Name" and "SKU". Export Item Library as CSV.');
 const heads=rows[headIndex].map(clean);
 const col=(...names)=>heads.findIndex(h=>names.includes(h));
 const itemCol=col('item name'), skuCol=col('sku'), variationCol=col('variation name');
 const priceCol=heads.findIndex(h=>h==='price');
 const otherPriceCols=heads.map((h,i)=>({h,i})).filter(x=>/^price\s*[([]/.test(x.h)).map(x=>x.i);
 const priceCols=[priceCol,...otherPriceCols].filter(i=>i>=0);
 if(!priceCols.length)throw new Error('Could not find a Price column in the Square CSV.');
 const result=[];
 for(const r of rows.slice(headIndex+1)){
  let name=(r[itemCol]||'').trim(), sku=(r[skuCol]||'').trim(), variation=variationCol<0?'':(r[variationCol]||'').trim();
  if(!name)continue;
  const priceText=priceCols.map(i=>(r[i]||'').trim()).find(Boolean)||'';
  let amount=priceText.replace(/[$,]/g,'').trim();
  // Square can mark prices as variable; these are not safe to auto-fill.
  const usable=amount!==''&&/^\d+(?:\.\d{1,2})?$/.test(amount)&&Number.isFinite(Number(amount));
  result.push({name,sku,variation,price:usable?Number(amount).toFixed(2):'',rawPrice:priceText});
 }
 return result;
}
function drawSquareResults(){
 const q=sq.squareSearch.value.trim().toLowerCase();
 visibleSquareRows=squareRows.filter(r=>(r.name+' '+r.variation+' '+r.sku).toLowerCase().includes(q)).slice(0,150);
 sq.squareItem.replaceChildren();
 if(!visibleSquareRows.length){let o=document.createElement('option');o.textContent='No matching items';sq.squareItem.add(o);sq.useSquare.disabled=true;return;}
 visibleSquareRows.forEach((r,i)=>{
  const o=document.createElement('option');o.value=String(i);
  o.textContent=[r.name,r.variation&&r.variation!=='Regular'?(' — '+r.variation):'',r.sku?' · '+r.sku:' · NO SKU',r.price?' · $'+r.price:' · NO PRICE'].join('');
  sq.squareItem.add(o);
 });
 sq.squareItem.selectedIndex=0;sq.useSquare.disabled=false;
}
sq.squareFile.addEventListener('change',async()=>{
 const f=sq.squareFile.files?.[0];if(!f)return;
 sq.squareSearch.disabled=true;sq.squareItem.disabled=true;sq.useSquare.disabled=true;
 try{
  if(f.size>30*1024*1024)throw new Error('CSV is over 30 MB. Export a smaller, filtered Square catalog.');
  squareRows=parseSquareCsv(await f.text());
  if(!squareRows.length)throw new Error('No inventory items found in the CSV.');
  sq.squareSearch.value='';sq.squareSearch.disabled=false;sq.squareItem.disabled=false;drawSquareResults();
  showSquareStatus(`${squareRows.length} Square product variations loaded from ${f.name}. Data stays in this browser tab.`);
 }catch(e){squareRows=[];sq.squareItem.replaceChildren();showSquareStatus('Import failed: '+e.message);}
});
sq.squareSearch.addEventListener('input',drawSquareResults);
sq.squareItem.addEventListener('change',()=>{sq.useSquare.disabled=sq.squareItem.selectedIndex<0;});
sq.useSquare.addEventListener('click',()=>{
 const row=visibleSquareRows[Number(sq.squareItem.value)];if(!row)return;
 els.name.value=row.variation&&row.variation.toLowerCase()!=='regular'?`${row.name} — ${row.variation}`:row.name;
 els.sku.value=row.sku;els.price.value=row.price;
 render();
 const missing=[!row.sku&&'SKU',!row.price&&'price'].filter(Boolean);
 setStatus(missing.length?`Selected ${row.name}. Square item is missing ${missing.join(' and ')}; enter before printing.`:`Selected ${row.name}. Review the label and print when ready.`);
});

let printer = null;
let valid = false;
const setStatus = text => { els.status.textContent = text; };
const money = raw => { const value=Number(raw); if(!Number.isFinite(value)||value<0||value>999999) throw new Error('Enter a valid nonnegative price.'); return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value); };
const getSku = () => {const sku=els.sku.value.trim();if(!sku||sku.length>32||!/^[\x20-\x7E]+$/.test(sku))throw new Error('SKU must contain 1–32 printable English letters, numbers, or symbols.');return sku;};
function fitText(text,maxPx,maxWidth,weight='700',font='Arial') {
 let size=maxPx;
 do {ctx.font=`${weight} ${size}px ${font}`;if(ctx.measureText(text).width<=maxWidth) break;size-=2;}while(size>17);
 return size;
}
function barcodeCanvas(sku){
 const out=document.createElement('canvas');
 // Full machine-readable Code 128 barcode, with automatic checksum.
 JsBarcode(out,sku,{format:'CODE128',width:2,height:68,margin:0,displayValue:false,background:'#ffffff',lineColor:'#000000'});
 return out;
}
function render(){
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
 try{
  const sku=getSku(), price=money(els.price.value);
  let name=els.name.value.trim();if(!name)throw new Error('Enter a product name.');
  ctx.fillStyle='#111111';ctx.textAlign='left';ctx.textBaseline='middle';
  if(els.brand.checked){ctx.font='700 19px Arial';ctx.fillText('SHADOWS & SWEETHEARTS',25,29);ctx.fillRect(25,44,W-50,2);}
  const top=els.brand.checked?70:40;
  const titleSize=fitText(name,34,W-50);
  ctx.font=`700 ${titleSize}px Arial`;ctx.fillText(name,25,top,W-50);
  const priceSize=fitText(price,65,290);
  ctx.font=`800 ${priceSize}px Arial`;ctx.fillText(price,26,152);
  const bar=barcodeCanvas(sku);
  // Keep barcode quiet zones: a 20-dot margin on both sides.
  const maxBW=290, maxBH=82;
  const scale=Math.min(1,maxBW/bar.width,maxBH/bar.height);
  const bW=Math.round(bar.width*scale),bH=Math.round(bar.height*scale);
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(bar,W-24-bW,114,bW,bH);
  ctx.imageSmoothingEnabled=true;
  ctx.font='17px Arial';ctx.textAlign='right';ctx.fillText(sku,W-28,215,W-50);
  ctx.textAlign='left';ctx.fillStyle='#444';ctx.font='16px Arial';ctx.fillText('SKU  '+sku,26,251,W-50);
  valid=true;
  if(printer) els.print.disabled=false;
  return true;
 }catch(error){valid=false;els.print.disabled=true;ctx.fillStyle='#7d2128';ctx.font='20px Arial';ctx.fillText(error.message.slice(0,50),24,230);setStatus(error.message);return false;}
}
function sameMedia(m){if(!m)return false;let a=Number(m.widthMm),b=Number(m.heightMm);if(!Number.isFinite(a)||!Number.isFinite(b))return false;return Math.abs(Math.max(a,b)-54)<2.5&&Math.abs(Math.min(a,b)-25)<2.5;}
function selectedMedia(){return Object.values(MEDIA).find(m=>m && sameMedia(m));}
async function connect(){
 els.connect.disabled=true;setStatus('Connecting to the printer…');
 try{
  if(printer){try{await printer.close();}catch{} printer=null;}
  // Reuse browser's permission if available; otherwise ask during a click.
  const previous=await navigator.usb.getDevices();
  const device=previous.find(d=>d.vendorId===0x0922&&d.productId===0x0028);
  try{printer=device?await fromUSBDevice(device):await requestPrinter();}
  catch(e){if(device) printer=await requestPrinter();else throw e;}
  const status=await printer.getStatus();
  if(!status.ready)throw new Error('DYMO is connected but not ready. Check paper and lights. '+(status.errors?.map(x=>x.message||x.code||x).join(', ')||''));
  if(status.mediaLoaded===false)throw new Error('No labels detected. Insert genuine DYMO 30336 roll.');
  if(status.detectedMedia && !sameMedia(status.detectedMedia))throw new Error('Loaded label size does not match 30336 (25 × 54 mm). Change the roll before printing.');
  els.connect.textContent='Reconnect DYMO';
  setStatus('Connected and ready. Confirm you loaded genuine DYMO 30336 labels, then print one test label.');
  els.print.disabled=!valid;
 }catch(e){setStatus('Connection problem: '+(e?.message||e));els.print.disabled=true;if(printer){try{await printer.close();}catch{}printer=null;}}
 finally{els.connect.disabled=false;}
}
async function print(){
 if(!printer||!render())return;
 const count=Number(els.qty.value);
 if(!Number.isInteger(count)||count<1||count>20){setStatus('Copies must be between 1 and 20.');return;}
 els.print.disabled=true;
 try{
  const st=await printer.getStatus();
  if(!st.ready||st.mediaLoaded===false)throw new Error('Printer not ready or labels absent.');
  if(st.detectedMedia&&!sameMedia(st.detectedMedia))throw new Error('Loaded labels do not match 30336; printing cancelled.');
  // The labelwriter API takes browser canvas RGBA data.
  const img=ctx.getImageData(0,0,W,H);
  const image={width:W,height:H,data:new Uint8Array(img.data)};
  const media=selectedMedia();
  if(!media)throw new Error('Driver package has no 30336 media definition.');
  for(let i=0;i<count;i++){
   setStatus(`Printing ${i+1} of ${count}…`);
   await printer.print(image,media);
  }
  setStatus(`Sent ${count} label${count===1?'':'s'} to DYMO. Check the physical result, including barcode scanning.`);
 }catch(e){setStatus('Printing failed: '+(e?.message||e)+' — reconnect if needed, then retry one label.');}
 finally{els.print.disabled=!valid||!printer;}
}
els.connect.addEventListener('click',connect);
els.print.addEventListener('click',print);
for(const k of ['name','price','sku','brand'])els[k].addEventListener('input',()=>{render();if(valid&&!printer)setStatus('Preview ready. Click Connect DYMO 550 to enable printing.');});
els.png.addEventListener('click',()=>{if(!render())return;const link=document.createElement('a');link.download='shadows-sweethearts-30336-label.png';link.href=els.labelCanvas.toDataURL('image/png');link.click();});
render();setStatus('Preview ready. Click Connect DYMO 550 to enable printing.');
if(!navigator.usb){setStatus('Chrome WebUSB is unavailable. Open the hosted HTTPS site in Chrome on the Chromebook.');els.connect.disabled=true;}
