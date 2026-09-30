import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import InvoiceExportSheet from "../../src/components/InvoiceExportSheet";
import { EMPTY_BANK } from "../../src/components/BankDetails";
import "../../src/index.css";
import { PDFDocument, StandardFonts, PDFName } from "pdf-lib";
import { pdfToImages, pdfToText, sanitizePdf, imagesToPdf, svgToImage, imageToSvg, elementToPdfBytes, encryptPdf, decryptPdf, removeRestrictions, heicToPdf } from "../../src/lib/pdfTools";

const artifacts: {name:string;base64:string}[]=[];
const checks: {name:string;ms:number}[]=[];
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
const file=(name:string,bytes:Uint8Array,type="application/pdf")=>new File([bytes.slice().buffer],name,{type});
async function check(name:string,run:()=>Promise<void>){const start=performance.now();await run();checks.push({name,ms:Math.round(performance.now()-start)});}

try {
  const pdf=await PDFDocument.create();
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([300,200]).drawText("Filey fixture 42",{x:20,y:140,font,size:18});
  pdf.setTitle("Private metadata fixture");
  await pdf.attach(new TextEncoder().encode("Private attachment fixture"),"private.txt");
  const source=file("fixture.pdf",await pdf.save());
  await check("PDF text through real web worker",async()=>{
    assert(new TextDecoder().decode((await pdfToText(source)).bytes).includes("Filey fixture 42"),"PDF text missing");
  });
  await check("Password removal opens without a password and preserves selectable content",async()=>{
    const encrypted=await encryptPdf(source,{userPassword:"fixture-password",ownerPassword:"fixture-owner",copying:false});
    const locked=file(encrypted.name,encrypted.bytes);
    let refused=false;
    try {await decryptPdf(locked,"incorrect-fixture-password");} catch(error) {refused=/password/i.test(String(error));}
    assert(refused,"Incorrect password was accepted");
    const unlocked=await decryptPdf(locked,"fixture-password");
    const parsed=await PDFDocument.load(unlocked.bytes);
    assert(!parsed.isEncrypted && parsed.getPageCount()===1,"Password was not removed or pages changed");
    assert(new TextDecoder().decode((await pdfToText(file(unlocked.name,unlocked.bytes))).bytes).includes("Filey fixture 42"),"Password removal lost text");
    const restricted=await encryptPdf(source,{ownerPassword:"fixture-owner",printing:false});
    const opened=await removeRestrictions(file(restricted.name,restricted.bytes));
    assert(new TextDecoder().decode((await pdfToText(file(opened.name,opened.bytes))).bytes).includes("Filey fixture 42"),"Permission removal lost text");
  });
  await check("PDF canvas rendering and image-to-PDF round trip",async()=>{
    const images=await pdfToImages(source,1);
    assert(images.length===1,"Wrong page count");
    const bitmap=await createImageBitmap(new Blob([images[0].bytes.slice().buffer],{type:"image/png"}));
    assert(bitmap.width===300 && bitmap.height===200,"Wrong rendered dimensions");bitmap.close();
    const output=await imagesToPdf([file("page.png",images[0].bytes,"image/png")]);
    assert((await PDFDocument.load(output.bytes)).getPageCount()===1,"Image conversion lost page");
  });
  await check("Cancellation releases the worker and a later conversion still succeeds",async()=>{
    const controller=new AbortController();
    let cancelled=false;
    try { await pdfToImages(source,1,{signal:controller.signal,onProgress:()=>controller.abort()}); } catch {cancelled=true;}
    assert(cancelled,"Cancelled conversion completed");
    assert((await pdfToImages(source,1)).length===1,"Worker did not recover after cancellation");
  });
  await check("Sanitization removes attachments and metadata while preserving visible output",async()=>{
    const output=await sanitizePdf(source);
    const clean=await PDFDocument.load(output.bytes);
    assert(clean.getPageCount()===1,"Sanitization lost page");
    assert(clean.getTitle()!=="Private metadata fixture","Private title retained");
    assert(!clean.catalog.has(PDFName.of("Names")),"Attachment tree retained");
    const images=await pdfToImages(file(output.name,output.bytes),1);
    assert(images[0].bytes.length>100,"Sanitized page failed to render");
  });
  await check("SVG image conversion and lazy WASM vector tracing",async()=>{
    const svg=new File(['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#ffd600"/></svg>'],"fixture.svg",{type:"image/svg+xml"});
    const image=await svgToImage(svg,"png",1);
    const bitmap=await createImageBitmap(new Blob([image.bytes.slice().buffer],{type:"image/png"}));
    assert(bitmap.width===80 && bitmap.height===40,"SVG dimensions changed");bitmap.close();
    const vector=await imageToSvg(file("fixture.png",image.bytes,"image/png"));
    const markup=new TextDecoder().decode(vector.bytes);
    assert(markup.includes("<path") && !markup.includes("<image"),"Vector tracing did not produce actual paths");
  });
  await check("HEIC decoding under the desktop content security policy",async()=>{
    // Official 7 KB libheif image, pinned to commit
    // bc292d97abed6b1ba1fc3d95c4191829ee99b088, tests/data/rainbow-451x461.heic.
    const response=await fetch(new URL("./rainbow-451x461.heic",import.meta.url));
    assert(response.ok,"HEIC fixture missing");
    const source=file("fixture.heic",new Uint8Array(await response.arrayBuffer()),"image/heic");
    const output=await heicToPdf(source);
    const pdf=await PDFDocument.load(output.bytes);
    assert(pdf.getPageCount()===1 && pdf.getPage(0).getWidth()===451 && pdf.getPage(0).getHeight()===461,"HEIC output has wrong image dimensions");
    assert((await pdfToImages(file(output.name,output.bytes),1))[0].bytes.length>100,"HEIC output cannot be rendered");
  });
  await check("Arabic invoice fields and real PDF raster output",async()=>{
    const holder=document.createElement("div");holder.style.width="794px";document.body.append(holder);
    const root=createRoot(holder);
    flushSync(()=>root.render(createElement(InvoiceExportSheet,{bank:EMPTY_BANK,form:{
      template:"minimal",currency:"AED",tax_country_code:"AE",number:"RTL-FIXTURE",issue_date:"2026-09-13",
      seller_name:"شركة الملفات للتجارة",seller_address:"دبي، الإمارات العربية المتحدة",
      customer_name:"شركة النور",customer_address:"أبوظبي، الإمارات العربية المتحدة",
      tax_rate:5,discount:0,notes:"شكراً لتعاملكم معنا. يرجى الاحتفاظ بهذه الفاتورة.",
      items:[{description:"خدمة إعداد الفواتير",qty:2,unit_price:120}]
    }})));
    try {
      await document.fonts.ready;
      const customer=[...holder.querySelectorAll('[dir="auto"]')].find(el=>el.textContent==="شركة النور");
      assert(customer && getComputedStyle(customer).direction==="rtl","Arabic customer direction is not RTL");
      const output=await elementToPdfBytes(holder,"arabic-invoice");
      assert((await PDFDocument.load(output.bytes)).getPageCount()===1,"Arabic fixture changed page count");
      const pages=await pdfToImages(file(output.name,output.bytes),0.8);
      const bytes=pages[0].bytes;
      let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);
      artifacts.push({name:"arabic-invoice.png",base64:btoa(binary)});
    } finally {root.unmount();holder.remove();}
  });
  const result={ok:true,checks,artifacts};document.getElementById("result")!.textContent=JSON.stringify(result,null,2);
  await fetch("/__filey_fixture_result",{method:"POST",body:JSON.stringify(result)});
} catch(error) {
  const result={ok:false,checks,error:String(error)};document.getElementById("result")!.textContent=JSON.stringify(result,null,2);
  await fetch("/__filey_fixture_result",{method:"POST",body:JSON.stringify(result)});
}
