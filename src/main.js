import './style.css';
import JsBarcode from 'jsbarcode';
import { requestPrinter, fromUSBDevice } from '@thermal-label/labelwriter-web';
import { MEDIA } from '@thermal-label/labelwriter-core';

// DYMO 30336: 54 mm across printer head, 25 mm feed direction, @ 300 dpi.
const W = 638, H = 295;
const els = Object.fromEntries(['name','price','qty','sku','brand','nameFontSize','nameFontValue','nameFontActual','resetNameFont','connect','print','status','png','labelCanvas'].map(id=>[id,document.getElementById(id)]));
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
 const categoryCol=col('category','categories','reporting category');
 // Square exports may contain separate per-location current quantity columns.
 const stockCols=heads.map((h,i)=>({h,i})).filter(x=>/^(current quantity|current stock|quantity on hand)(\s|$)/.test(x.h)).map(x=>x.i);
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
  const quantities=stockCols.map(i=>String(r[i]??'').replace(/,/g,'').trim());
  const knownQuantities=quantities.filter(v=>/^-?\d+(?:\.\d+)?$/.test(v));
  const stock=stockCols.length&&knownQuantities.length===stockCols.length?knownQuantities.reduce((n,v)=>n+Number(v),0):null;
  result.push({name,sku,variation,price:usable?Number(amount).toFixed(2):'',rawPrice:priceText,category:categoryCol>=0?(r[categoryCol]||'').trim()||'Uncategorized':'Uncategorized',stock});
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
  initializeBatch();
  showSquareStatus(`${squareRows.length} Square product variations loaded from ${f.name}. Data stays in this browser tab.`);
 }catch(e){squareRows=[];sq.squareItem.replaceChildren();initializeBatch();showSquareStatus('Import failed: '+e.message);}
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
// Wrap product names into full-size lines instead of letting canvas silently
// compress a single line horizontally (fillText's maxWidth argument).
function wrapProductName(name, size, maxWidth) {
 ctx.font = `700 ${size}px Arial`;
 const lines = [];
 let line = '';
 for (const word of name.trim().split(/\s+/)) {
  const candidate = line ? line + ' ' + word : word;
  if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
  if (line) { lines.push(line); line = ''; }
  // Split rare extra-long strings rather than squeezing the text horizontally.
  let chunk = '';
  for (const char of word) {
   if (chunk && ctx.measureText(chunk + char).width > maxWidth) {
    lines.push(chunk); chunk = char;
   } else chunk += char;
  }
  line = chunk;
 }
 if (line) lines.push(line);
 return lines;
}
// Honor the slider exactly. We never reduce the user's requested font size.
// When the selected text cannot fit on the physical label, we visibly mark
// the shortened preview so that no print silently alters the name.
function titleLayout(name, requestedSize, branded) {
 const size = Math.max(16, Math.min(42, Math.round(requestedSize) || 28));
 const startY = branded ? 57 : 25;
 const maxBottom = 150; // Space above price / machine-readable barcode.
 const lineHeight = Math.ceil(size * 1.12);
 const maxLines = Math.max(1, Math.floor((maxBottom-startY) / lineHeight));
 const lines = wrapProductName(name, size, W-50);
 const shortened = lines.length > maxLines;
 const visibleLines = lines.slice(0,maxLines);
 if(shortened){
  // Ellipsis belongs to the visible preview and printed result.
  let last = visibleLines[maxLines-1];
  ctx.font=`700 ${size}px Arial`;
  const suffix='…';
  while(last && ctx.measureText(last+suffix).width > W-50) last=last.slice(0,-1);
  visibleLines[maxLines-1]=last.trimEnd()+suffix;
 }
 return {size, lines:visibleLines, shortened, startY, lineHeight};
}
function fitText(text,maxPx,maxWidth,weight='700',font='Arial') {
 let size=maxPx;
 do {ctx.font=`${weight} ${size}px ${font}`;if(ctx.measureText(text).width<=maxWidth)break;size-=2;}while(size>17);
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
  const title=titleLayout(name,Number(els.nameFontSize.value),els.brand.checked);
  ctx.font=`700 ${title.size}px Arial`;
  ctx.textBaseline='top';
  title.lines.forEach((line,i)=>ctx.fillText(line,25,title.startY+i*title.lineHeight));
  ctx.textBaseline='middle';
  if (els.nameFontActual) {
   els.nameFontActual.textContent = `Printed name: ${title.size} px · ${title.lines.length} line${title.lines.length===1?'':'s'}` +
    (title.shortened ? ' · TITLE SHORTENED TO FIT (choose a smaller size or a shorter name)' : ' · full title fits');
   els.nameFontActual.style.color = title.shortened ? '#a31b26' : '';
  }
  const priceSize=fitText(price,65,290);
  ctx.font=`800 ${priceSize}px Arial`;ctx.fillText(price,26,206);
  const bar=barcodeCanvas(sku);
  // Keep barcode quiet zones: a 20-dot margin on both sides.
  const maxBW=290, maxBH=82;
  const scale=Math.min(1,maxBW/bar.width,maxBH/bar.height);
  const bW=Math.round(bar.width*scale),bH=Math.round(bar.height*scale);
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(bar,W-24-bW,151,bW,bH);
  ctx.imageSmoothingEnabled=true;
  ctx.font='17px Arial';ctx.textAlign='right';ctx.fillText(sku,W-28,240,W-50);
  ctx.textAlign='left';ctx.fillStyle='#444';ctx.font='16px Arial';ctx.fillText('SKU  '+sku,26,270,W-50);
  valid=true;
  if(printer) els.print.disabled=false;
  return true;
 }catch(error){valid=false;els.print.disabled=true;if(els.nameFontActual)els.nameFontActual.textContent='Preview error — check product name, price and SKU.';ctx.fillStyle='#7d2128';ctx.font='20px Arial';ctx.fillText(error.message.slice(0,50),24,230);setStatus(error.message);return false;}
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
  els.print.disabled=!valid;updateBatchControls();
 }catch(e){setStatus('Connection problem: '+(e?.message||e));els.print.disabled=true;if(printer){try{await printer.close();}catch{}printer=null;}}
 finally{els.connect.disabled=false;updateBatchControls();}
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
// Applies to the preview, individual labels, and the shared batch renderer.
els.nameFontSize.addEventListener('input',()=>{
 els.nameFontValue.textContent=els.nameFontSize.value;
 render();
});
els.resetNameFont.addEventListener('click',()=>{
 els.nameFontSize.value='28';
 els.nameFontValue.textContent='28';
 render();
});
els.connect.addEventListener('click',connect);
els.print.addEventListener('click',print);
for(const k of ['name','price','sku','brand'])els[k].addEventListener('input',()=>{render();if(valid&&!printer)setStatus('Preview ready. Click Connect DYMO 550 to enable printing.');});
els.png.addEventListener('click',()=>{if(!render())return;const link=document.createElement('a');link.download='shadows-sweethearts-30336-label.png';link.href=els.labelCanvas.toDataURL('image/png');link.click();});
render();setStatus('Font control v4 loaded. Preview ready. Connect DYMO 550 to print.');
if(!navigator.usb){setStatus('Chrome WebUSB is unavailable. Open the hosted HTTPS site in Chrome on the Chromebook.');els.connect.disabled=true;}


// Batch queue uses the same validated canvas renderer and the same printer.print path
// as the already-working single-label printer. It makes no Square API calls.
const b=Object.fromEntries(['batchCategory','batchSearch','stockOnly','batchStockHelp','batchSelect','batchClear','batchCopies','batchApplyCopies','batchRows','batchSummary','batchPrint','batchStop','batchStatus'].map(id=>[id,document.getElementById(id)]));
const selections=new Map(); // index in imported Square CSV => copies
let batchBusy=false, stopRequested=false;
const batchStatus = text=>{b.batchStatus.textContent=text;};
const printable = row=>!!row && !!row.sku && row.sku.length<=32 && /^[\x20-\x7e]+$/.test(row.sku) && row.price!=='' && Number.isFinite(Number(row.price)) && Number(row.price)>=0 && Number(row.price)<=999999;
const labelName = row=>row.variation && row.variation.toLowerCase()!=='regular'?`${row.name} — ${row.variation}`:row.name;
function filteredBatchIndices(){
 const cat=b.batchCategory.value, q=b.batchSearch.value.trim().toLowerCase();
 return squareRows.map((row,i)=>({row,i})).filter(({row})=>
  (cat==='*'||row.category===cat) &&
  (!b.stockOnly.checked || (row.stock!==null && row.stock>0)) &&
  (row.name+' '+row.variation+' '+row.sku).toLowerCase().includes(q)).map(x=>x.i);
}
function initializeBatch(){
 selections.clear();b.batchSearch.value='';b.stockOnly.checked=false;
 const categories=[...new Set(squareRows.map(x=>x.category))].sort((a,c)=>a.localeCompare(c));
 b.batchCategory.replaceChildren();
 for(const [value,label] of [['*','All categories'],...categories.map(c=>[c,c])]){
  const option=document.createElement('option');option.value=value;option.textContent=label;b.batchCategory.add(option);
 }
 const hasStock=squareRows.some(row=>row.stock!==null);
 b.stockOnly.disabled=!hasStock;
 b.batchStockHelp.textContent=hasStock?'Only in stock uses quantities from the imported CSV, not live Square availability. Products without a readable quantity are excluded.':'No recognized current-quantity columns were found in this CSV; in-stock filtering is unavailable.';
 b.batchCategory.disabled=b.batchSearch.disabled=b.batchSelect.disabled=b.batchClear.disabled=b.batchApplyCopies.disabled=!squareRows.length;
 renderBatchRows();
}
function updateBatchControls(){
 const total=[...selections.values()].reduce((a,c)=>a+c,0);
 b.batchSummary.textContent=`${selections.size} products selected · ${total} labels${total>500?' — over 500-label limit':''}`;
 b.batchPrint.disabled=!printer||!selections.size||total>500||batchBusy;
 b.batchStop.disabled=!batchBusy;
 b.batchSelect.disabled=b.batchClear.disabled=b.batchApplyCopies.disabled=batchBusy||!squareRows.length;
 b.batchCategory.disabled=b.batchSearch.disabled=batchBusy||!squareRows.length;
 b.stockOnly.disabled=batchBusy||!squareRows.some(row=>row.stock!==null);
 b.batchCopies.disabled=batchBusy;
 b.batchRows.querySelectorAll('input').forEach(input=>input.disabled=batchBusy||input.dataset.invalid==='true');
}
function renderBatchRows(){
 b.batchRows.replaceChildren();
 const indices=filteredBatchIndices();
 const visible=indices.slice(0,400);
 if(!visible.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='No matching products.';tr.append(td);b.batchRows.append(tr);}
 for(const i of visible){
  const row=squareRows[i], ok=printable(row);
  const tr=document.createElement('tr');if(!ok)tr.className='invalid';
  const checktd=document.createElement('td'),check=document.createElement('input');check.type='checkbox';check.checked=selections.has(i);check.dataset.invalid=String(!ok);
  check.setAttribute('aria-label','Select '+labelName(row));
  check.addEventListener('change',()=>{if(check.checked)selections.set(i,Number(b.batchCopies.value)||1);else selections.delete(i);renderBatchRows();});checktd.append(check);
  const nametd=document.createElement('td'),main=document.createElement('span'),sub=document.createElement('small');main.textContent=labelName(row);sub.textContent=(row.sku||'NO SKU')+' · '+row.category+(row.stock!==null?' · stock '+row.stock:'')+(!ok?' · missing/invalid SKU or price':'');nametd.append(main,sub);
  const pricetd=document.createElement('td');pricetd.textContent=row.price?'$'+row.price:'—';
  const copytd=document.createElement('td'),copies=document.createElement('input');copies.type='number';copies.min='1';copies.max='20';copies.value=selections.get(i)||Number(b.batchCopies.value)||1;copies.dataset.invalid=String(!ok);copies.setAttribute('aria-label','Copies for '+labelName(row));
  copies.addEventListener('change',()=>{const value=Number(copies.value);if(!Number.isInteger(value)||value<1||value>20){copies.value=selections.get(i)||1;return;}if(selections.has(i))selections.set(i,value);updateBatchControls();});copytd.append(copies);
  tr.append(checktd,nametd,pricetd,copytd);b.batchRows.append(tr);
 }
 if(indices.length>400){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent=`Showing first 400 of ${indices.length} matching products. Narrow the search to view additional items. “Select all filtered” includes all matching valid items.`;tr.append(td);b.batchRows.append(tr);}
 updateBatchControls();
}
b.batchCategory.addEventListener('change',renderBatchRows);b.batchSearch.addEventListener('input',renderBatchRows);b.stockOnly.addEventListener('change',renderBatchRows);
b.batchSelect.addEventListener('click',()=>{const copies=Number(b.batchCopies.value);if(!Number.isInteger(copies)||copies<1||copies>20){batchStatus('Copies must be 1–20.');return;}for(const i of filteredBatchIndices())if(printable(squareRows[i]))selections.set(i,copies);renderBatchRows();});
b.batchClear.addEventListener('click',()=>{selections.clear();renderBatchRows();});
b.batchApplyCopies.addEventListener('click',()=>{const copies=Number(b.batchCopies.value);if(!Number.isInteger(copies)||copies<1||copies>20){batchStatus('Copies must be 1–20.');return;}for(const i of selections.keys())selections.set(i,copies);renderBatchRows();});
b.batchStop.addEventListener('click',()=>{stopRequested=true;batchStatus('Stop requested; finishing the current label.');});
b.batchPrint.addEventListener('click',async()=>{
 if(!printer||batchBusy)return;
 const queue=[...selections.entries()].map(([i,copies])=>({row:squareRows[i],copies}));
 const total=queue.reduce((a,x)=>a+x.copies,0);
 if(total<1||total>500){batchStatus('Choose 1–500 labels.');return;}
 if(queue.some(x=>!printable(x.row)||!Number.isInteger(x.copies)||x.copies<1||x.copies>20)){batchStatus('Selection has invalid product data or copies.');return;}
 if(!window.confirm(`Send ${total} labels for ${queue.length} products to your DYMO 550? Check the loaded 30336 roll first.`))return;
 batchBusy=true;stopRequested=false;updateBatchControls();
 const original={name:els.name.value,price:els.price.value,sku:els.sku.value};let completed=0;
 try{
  const st=await printer.getStatus();if(!st.ready||st.mediaLoaded===false)throw new Error('Printer is not ready or labels are absent.');
  if(st.detectedMedia&&!sameMedia(st.detectedMedia))throw new Error('Loaded labels do not match 30336.');
  const media=selectedMedia();if(!media)throw new Error('Driver has no 30336 media definition.');
  outer: for(const item of queue){
   els.name.value=labelName(item.row);els.price.value=item.row.price;els.sku.value=item.row.sku;
   if(!render())throw new Error('Could not render '+labelName(item.row));
   const img=ctx.getImageData(0,0,W,H);const image={width:W,height:H,data:new Uint8Array(img.data)};
   for(let copy=0;copy<item.copies;copy++){
    if(stopRequested)break outer;
    batchStatus(`Sending label ${completed+1} of ${total}: ${labelName(item.row)} (${copy+1}/${item.copies})`);
    await printer.print(image,media);completed++;
   }
  }
  batchStatus(stopRequested?`Stopped after ${completed} of ${total} labels sent. Check physical output before restarting.`:`Finished sending ${completed} labels to the DYMO. Verify the labels and scan a barcode.`);
 }catch(e){batchStatus(`Batch stopped after ${completed} of ${total} labels sent. ${e?.message||e} Check which labels printed before retrying.`);}
 finally{els.name.value=original.name;els.price.value=original.price;els.sku.value=original.sku;render();batchBusy=false;updateBatchControls();}
});
initializeBatch();
