import { deflateRawSync } from 'node:zlib';

// Synthetic, nonprivate fixtures generated in the test temp directory.
export function pdf(texts, jpeg) {
  const objects = [];
  const add = (body) => { objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body)); return objects.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let image;
  if (jpeg) image = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1000 /Height 240 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from("\nendstream")]));
  const kids = [];
  for (const text of texts) {
    const content = text ? `BT /F1 22 Tf 40 300 Td (${text}) Tj ET` : "q 500 0 0 120 30 150 cm /Im1 Do Q";
    const stream = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 ${font} 0 R >> ${image ? `/XObject << /Im1 ${image} 0 R >>` : ""} >> /Contents ${stream} 0 R >>`));
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const chunks = [Buffer.from("%PDF-1.7\n")];
  const offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    chunks.push(chunk); offset += chunk.length;
  });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((entry) => `${String(entry).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`));
  return Buffer.concat(chunks);
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zip(parts, options = {}) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, source] of Object.entries(parts)) {
    const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
    const compressed = deflateRawSync(bytes);
    const filename = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(bytes), 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(options.fakeSize ?? bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(crc32(bytes), 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(options.fakeSize ?? bytes.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename); offset += header.length + filename.length + compressed.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(parts).length, 8); end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (entries) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`;
export function presentation(png) {
  return {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "ppt/presentation.xml": `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="rSecond"/><p:sldId id="257" r:id="rFirst"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels(`<Relationship Id="rFirst" Type="${R}/slide" Target="slides/slide1.xml"/><Relationship Id="rSecond" Type="${R}/slide" Target="slides/slide2.xml"/>`),
    "ppt/slides/slide1.xml": `<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><a:p><a:r><a:t>Foreign keys link records.</a:t></a:r></a:p></p:cSld></p:sld>`,
    "ppt/slides/slide2.xml": `<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld><a:p><a:r><a:t>Customers &amp; bookings</a:t></a:r></a:p><a:blip r:embed="rImage"/></p:cSld></p:sld>`,
    "ppt/slides/_rels/slide2.xml.rels": rels(`<Relationship Id="rNote" Type="${R}/notesSlide" Target="../notesSlides/notesSlide7.xml"/><Relationship Id="rImage" Type="${R}/image" Target="../media/image1.png"/><Relationship Id="rExternal" Type="${R}/hyperlink" Target="https://example.invalid/private" TargetMode="External"/>`),
    "ppt/notesSlides/notesSlide7.xml": `<p:notes xmlns:p="${P}" xmlns:a="${A}"><a:p><a:r><a:t>One customer can create many bookings.</a:t></a:r></a:p></p:notes>`,
    "ppt/media/image1.png": png,
  };
}
