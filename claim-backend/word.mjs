import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,basename,dirname} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {load} from 'cheerio';
import JSZip from 'jszip';
const runtimeRoot=join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies');
const bundledDocx=join(runtimeRoot,'node/node_modules/docx/package.json');
const require=createRequire(process.env.NODE_ENV!=='production'&&existsSync(bundledDocx)?bundledDocx:import.meta.url);
const {Document,Packer,Paragraph,TextRun,Table,TableRow,TableCell,ImageRun,Bookmark,SimpleField,AlignmentType,WidthType,TableLayoutType,BorderStyle,TableBorders,VerticalAlign,HeadingLevel}=require('docx');
const runFile=promisify(execFile);
const mm=value=>Math.round(value/25.4*1440),PX_PER_MM=96/25.4;
const CONTENT_WIDTH=mm(178),TABLE_FONT_SIZE=21,FAMILY=process.env.CLAIM_WORD_FONT||(process.platform==='darwin'?'Songti SC':'Noto Serif CJK SC'),FONT={ascii:FAMILY,hAnsi:FAMILY,eastAsia:FAMILY,cs:FAMILY};
const line={before:0,after:180,line:360};
function runs(text,options={},pageMap={}){
  const result=[],pattern=/\{\{PAGE:(\w+)\}\}/g;let last=0,match;
  while((match=pattern.exec(text))){
    if(match.index>last)result.push(new TextRun({text:text.slice(last,match.index),font:FONT,color:'000000',size:24,...options}));
    const field=new SimpleField('PAGEREF '+match[1]+' \\h \\* MERGEFORMAT');
    field.addChildElement(new TextRun({text:String(pageMap[match[1]]||2),font:FONT,color:'000000',size:options.size??24,bold:options.bold}));
    result.push(field);last=pattern.lastIndex;
  }
  if(last<text.length||!result.length)result.push(new TextRun({text:text.slice(last),font:FONT,color:'000000',size:24,...options}));return result;
}
function plain($,node){return $(node).text().replace(/[ \t\n]+/g,' ').trim();}
function paragraphsFromHtml(html,pageMap){
  const $=load(html),blocks=[];
  function inline(node,format={}){
    if(node.type==='text')return runs(node.data.replace(/[ \t\r\n]+/g,' '),format,pageMap);
    if(node.name==='br')return [new TextRun({break:1})];
    const style={...format};if(['b','strong','th'].includes(node.name))style.bold=true;
    return (node.children||[]).flatMap(child=>inline(child,style));
  }
  function paragraph(node,context={}){
    const heading=['h2','h3','h4'].includes(node.name),title=node.name==='h2';
    const children=inline(node,{size:context.cell?TABLE_FONT_SIZE:title?44:heading?32:24,bold:heading});
    const defendantCover=$(node).parents('.defendant-cover').length>0;
    return new Paragraph({children,style:title?'Title':undefined,alignment:title?AlignmentType.CENTER:context.center?AlignmentType.CENTER:AlignmentType.LEFT,spacing:context.signatureCell?line:context.cell?{before:0,after:0,line:276}:title?{before:0,after:defendantCover?0:360,line:540}:heading&&defendantCover?{before:120,after:80,line:380}:heading?{before:320,after:160,line:380}:line,indent:context.signature?{left:mm(85)}:!context.cell&&!heading&&!$(node).hasClass('no-indent')&&!$(node).hasClass('party-line')?{firstLine:480}:undefined,keepNext:heading||context.keepNext,widowControl:true});
  }
  function table(node,noBorders=false){
    const evidence=$(node).hasClass('evidence-official-table');
    const leftAligned=$(node).hasClass('left-aligned-table');
    const defendantCover=$(node).parents('.defendant-cover').length>0;
    const rowNodes=$(node).children('tbody,thead,tfoot').children('tr').toArray().concat($(node).children('tr').toArray());
    const count=Math.max(...rowNodes.map(row=>$(row).children('td,th').length));
    const firstCells=$(rowNodes[0]).children('td,th').toArray(),percent=firstCells.map(cell=>{const match=/width\s*:\s*([\d.]+)%/.exec($(cell).attr('style')||'');return match?Number(match[1]):null;});
    const explicit=percent.filter(value=>value!==null).reduce((sum,value)=>sum+value,0),unknown=percent.filter(value=>value===null).length;
    const widths=Array.from({length:count},(_v,index)=>Math.round(CONTENT_WIDTH*(percent[index]===null?(100-explicit)/Math.max(1,unknown):percent[index]||100/count)/100));
    const rows=rowNodes.map((row,index)=>new TableRow({tableHeader:index===0&&$(row).find('th').length>0,cantSplit:true,children:$(row).children('td,th').toArray().map((cell,column)=>new TableCell({width:{size:widths[column],type:WidthType.DXA},columnSpan:Number($(cell).attr('colspan'))||undefined,verticalAlign:VerticalAlign.CENTER,margins:{top:defendantCover?65:evidence?70:80,bottom:defendantCover?65:evidence?70:80,left:90,right:90},shading:cell.name==='th'?{fill:'F2F2F2'}:undefined,children:[new Paragraph({children:inline(cell,{size:TABLE_FONT_SIZE,bold:cell.name==='th'}),alignment:!leftAligned&&(cell.name==='th'||/^(\d+(?:-\d+)*|—)$/.test(plain($,cell)))?AlignmentType.CENTER:AlignmentType.LEFT,spacing:{before:0,after:0,line:276},widowControl:true})]}))}));
    return new Table({rows,width:{size:CONTENT_WIDTH,type:WidthType.DXA},columnWidths:widths,layout:TableLayoutType.FIXED,borders:noBorders?TableBorders.NONE:{top:{style:BorderStyle.SINGLE,size:6,color:'999999'},bottom:{style:BorderStyle.SINGLE,size:6,color:'999999'},left:{style:BorderStyle.SINGLE,size:6,color:'999999'},right:{style:BorderStyle.SINGLE,size:6,color:'999999'},insideHorizontal:{style:BorderStyle.SINGLE,size:6,color:'999999'},insideVertical:{style:BorderStyle.SINGLE,size:6,color:'999999'}}});
  }
  function walk(node,context={}){
    if(node.type==='text'){if(node.data.trim())blocks.push(new Paragraph({children:runs(node.data.trim(),{},pageMap),spacing:line}));return;}
    if(node.name==='table'){blocks.push(table(node));blocks.push(new Paragraph({text:'',spacing:{before:0,after:$(node).parents('.defendant-cover').length?80:160,line:40}}));return;}
    if($(node).hasClass('evidence-signing')){
      const cells=$(node).children('div').toArray().map(cell=>new TableCell({children:$(cell).find('p').toArray().map(p=>paragraph(p,{cell:true,signatureCell:true})),width:{size:CONTENT_WIDTH/2,type:WidthType.DXA},verticalAlign:VerticalAlign.TOP}));
      blocks.push(new Paragraph({text:'',spacing:{before:mm(8),after:0,line:40}}));blocks.push(new Table({rows:[new TableRow({cantSplit:true,children:cells})],borders:TableBorders.NONE,columnWidths:[CONTENT_WIDTH/2,CONTENT_WIDTH/2],width:{size:CONTENT_WIDTH,type:WidthType.DXA},layout:TableLayoutType.FIXED}));return;
    }
    if(['p','h2','h3','h4','pre'].includes(node.name)){blocks.push(paragraph(node,context));return;}
    if(node.name==='li'){blocks.push(new Paragraph({children:runs((context.itemIndex+1)+'. '+plain($,node),{},pageMap),spacing:{before:0,after:140,line:320},widowControl:true}));return;}
    if($(node).hasClass('signature')){const ps=$(node).children('p').toArray();blocks.push(new Paragraph({text:'',spacing:{before:mm(8),after:0,line:40}}));ps.forEach((p,index)=>blocks.push(paragraph(p,{signature:true,keepNext:index<ps.length-1})));return;}
    (node.children||[]).forEach((child,index)=>walk(child,{...context,itemIndex:index}));
  }
  $('body').contents().toArray().forEach(node=>walk(node));return blocks;
}
export async function createWord(spec,{imageScale=1,pageMap={}}={}){
  const children=paragraphsFromHtml(spec.html,pageMap);let initialPage=2;
  for(let groupIndex=0;groupIndex<spec.groups.length;groupIndex++){
    const group=spec.groups[groupIndex],bookmarks=group.pages.map((_page,index)=>'g'+(groupIndex+1)+'p'+(index+1));
    for(let pageIndex=0;pageIndex<group.pages.length;pageIndex++){
      const bookmark=bookmarks[pageIndex];if(!pageMap[bookmark])pageMap[bookmark]=initialPage;initialPage++;
      if(pageIndex===0){
        children.push(new Paragraph({children:[new Bookmark({id:bookmark,children:runs(group.label+' '+group.number+'：'+group.name,{bold:true,size:28},pageMap)})],pageBreakBefore:true,keepNext:true,heading:HeadingLevel.HEADING_2,outlineLevel:1,spacing:{before:0,after:100,line:320}}));
        const refs=bookmarks.map(key=>'{{PAGE:'+key+'}}').join('-');
        children.push(new Paragraph({children:runs('文件类型：'+group.types.join('、')+'　数量：'+group.count+'个　页码：'+refs,{size:20},pageMap),keepNext:true,spacing:{before:0,after:120,line:260}}));
      }
      const images=group.pages[pageIndex],heightBudget=(pageIndex===0?202:229)*imageScale,available=heightBudget-(images.length-1)*4;
      images.forEach((image,index)=>{
        const factor=Math.min(178/image.width,available/images.length/image.height),width=image.width*factor*PX_PER_MM,height=image.height*factor*PX_PER_MM;
        const drawing=new ImageRun({type:image.type==='jpg'?'jpg':'png',data:Buffer.from(image.base64,'base64'),transformation:{width,height},altText:{title:group.name,description:'材料编号'+group.number+'第'+(pageIndex+1)+'页'}});
        const elements=pageIndex>0&&index===0?[new Bookmark({id:bookmark,children:[new TextRun({text:'\u200B',size:2}),drawing]})]:[drawing];
        children.push(new Paragraph({children:elements,pageBreakBefore:pageIndex>0&&index===0,alignment:AlignmentType.CENTER,keepNext:index<images.length-1,spacing:{before:0,after:index<images.length-1?mm(4):0,line:240},run:{size:2}}));
      });
    }
  }
  const doc=new Document({creator:'',lastModifiedBy:'',title:spec.title,features:{updateFields:true},styles:{default:{document:{run:{font:FONT,size:24,color:'000000'},paragraph:{spacing:line,widowControl:true}}},paragraphStyles:[{id:'Title',name:'Title',basedOn:'Normal',run:{font:FONT,size:44,bold:true,color:'000000'},paragraph:{alignment:AlignmentType.CENTER,keepNext:true,spacing:{before:0,after:360,line:540}}},{id:'Heading2',name:'Heading 2',basedOn:'Normal',run:{font:FONT,size:32,bold:true,color:'000000'},paragraph:{spacing:{before:320,after:160,line:380},keepNext:true}}]},sections:[{properties:{page:{size:{width:mm(210),height:mm(297)},margin:{top:mm(25),bottom:mm(25),left:mm(16),right:mm(16)}}},children}]});
  const packed=await Packer.toBuffer(doc),archive=await JSZip.loadAsync(packed);let xml=await archive.file('word/document.xml').async('string'),sequence=0;const stack=[];
  // The SDK can reuse the same numeric bookmark ID. Names alone are not enough for all Word readers.
  xml=xml.replace(/<w:bookmark(?:Start|End)\b[^>]*\/>/g,tag=>{
    if(tag.startsWith('<w:bookmarkStart')){const id=++sequence;stack.push(id);return tag.replace(/w:id="[^"]*"/,'w:id="'+id+'"');}
    const id=stack.pop();return id?tag.replace(/w:id="[^"]*"/,'w:id="'+id+'"'):tag;
  });
  archive.file('word/document.xml',xml);return archive.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
function sofficePath(){const bundled=join(runtimeRoot,'bin/override/soffice');return process.env.CLAIM_SOFFICE_PATH||(process.env.NODE_ENV!=='production'&&existsSync(bundled)?bundled:'soffice');}
export async function renderWordPdfBatch(inputs,outputDir){
  if(!inputs.length)return [];
  const names=inputs.map(input=>basename(input,'.docx'));
  if(new Set(names).size!==names.length)throw Error('批量排版的Word文件名不能重复');
  await mkdir(outputDir,{recursive:true});const profile=join(dirname(outputDir),'lo-profile');await mkdir(profile,{recursive:true});
  const fontDir=join(dirname(fileURLToPath(import.meta.url)),'fonts'),config=join(outputDir,'fonts.conf'),cache=join(tmpdir(),'claim-word-font-cache-'+(typeof process.getuid==='function'?process.getuid():'local'));await mkdir(cache,{recursive:true});
  const escape=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const packaged=join(runtimeRoot,'native/libreoffice-headless/libreoffice/LibreOfficeDev.app/Contents/Resources/fontconfig/fonts.conf');
  await writeFile(config,'<?xml version="1.0"?><fontconfig>'+(existsSync(packaged)?'<include ignore_missing="yes">'+escape(packaged)+'</include>':'')+'<dir>'+escape(fontDir)+'</dir><dir>/usr/share/fonts</dir><cachedir>'+escape(cache)+'</cachedir></fontconfig>');
  await runFile(sofficePath(),['-env:UserInstallation='+pathToFileURL(profile).href,'--headless','--convert-to','pdf','--outdir',outputDir,...inputs],{timeout:120000,maxBuffer:1024*1024,env:{...process.env,FONTCONFIG_FILE:process.env.CLAIM_FONTCONFIG_FILE||config,SAL_USE_VCLPLUGIN:'svp'}});
  return Promise.all(names.map(name=>readFile(join(outputDir,name+'.pdf'))));
}
export async function renderWordPdf(input,outputDir){
  return (await renderWordPdfBatch([input],outputDir))[0];
}
export async function patchPageCaches(bytes,pageMap){
  const zip=await JSZip.loadAsync(bytes),entry=zip.file('word/document.xml');let xml=await entry.async('string');
  xml=xml.replace(/(<w:fldSimple\b[^>]*w:instr="PAGEREF (\w+)[^"]*"[^>]*>)([\s\S]*?)(<\/w:fldSimple>)/g,(all,start,key,body,end)=>pageMap[key]?start+body.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/g,'<w:t>'+pageMap[key]+'</w:t>')+end:all);
  zip.file('word/document.xml',xml);return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
