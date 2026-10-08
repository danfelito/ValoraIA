import {readFile,writeFile,mkdir} from "node:fs/promises";
import {commercialPdf} from "../supabase/functions/_shared/commercial-pdf.ts";
const data=JSON.parse(await readFile("tmp/report-preview.json","utf8"));
await mkdir("output/pdf",{recursive:true});
await writeFile("output/pdf/ValoraIA_Demostracion_Informe_Enriquecido.pdf",await commercialPdf(data));
console.log("Created demonstration PDF with simulated data");
