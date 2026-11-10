// Export real surface finishes; keep the source atlas only where it describes
// details (seams, lettering, lamps and trim), never as a reflection on paint.
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = (a, b, value) => { const t = clamp((value - a) / (b - a)); return t * t * (3 - 2 * t); };

// Linear values. A mid-deep pearl blue reads as blue under workshop light; the
// former near-black base only showed colour in direct highlights.
export const AUDI_PAINT = Object.freeze({ color: [.010, .036, .155, 1], metalness: .74, roughness: .28, coatRoughness: .03 });
const srgb8 = linear => Math.round(255 * (linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055));
// The tailgate window of the upload is a solid photographed surface. These
// triangles become opaque privacy glass instead of a grey textured panel.
const TAILGATE_GLASS = Object.freeze({ origin: [-2.171, .938, 0], normal: [-.6196, .7849, 0] });
function tailgateGlass(x, y, z) {
  if (x > -1.67 || x < -2.26 || y < .945 || y > 1.325 || Math.abs(z) > .64 - (y - .94) * .14) return false;
  const distance = (x - TAILGATE_GLASS.origin[0]) * TAILGATE_GLASS.normal[0] + (y - TAILGATE_GLASS.origin[1]) * TAILGATE_GLASS.normal[1];
  return distance > -.06 && distance < .16; // The pane bows outwards between its corners.
}

export async function createImportedCarMaterials(document, source, { sharp, clearcoatExtension }) {
  const atlas = source.getBaseColorTexture();
  const { data, info } = await sharp(atlas.getImage()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const clean = Buffer.from(data), packed = Buffer.alloc(info.width * info.height * 3);
  const coat = Buffer.alloc(packed.length);
  const neutral = AUDI_PAINT.color.slice(0, 3).map(srgb8);
  for (let pixel = 0; pixel < info.width * info.height; pixel++) {
    const offset = pixel * info.channels, target = pixel * 3;
    const r = data[offset], g = data[offset + 1], b = data[offset + 2];
    const blue = smooth(2, 13, b - r) * smooth(1, 10, b - g);
    const grey = (r + g + b) / 3;
    const brightMetal = smooth(45, 140, grey);
    for (let channel = 0; channel < 3; channel++) clean[offset + channel] = Math.round(data[offset + channel] * (1 - blue) + neutral[channel] * blue);
    packed[target] = 255;
    packed[target + 1] = Math.round(255 * ((.67 - .42 * brightMetal) * (1 - blue) + AUDI_PAINT.roughness * blue));
    packed[target + 2] = Math.round(255 * (.05 * (1 - brightMetal) * (1 - blue) + .93 * brightMetal * (1 - blue) + AUDI_PAINT.metalness * blue));
    coat[target] = Math.round(blue * 255); coat[target + 1] = Math.round(AUDI_PAINT.coatRoughness * 255);
  }
  const texture = async (name, bytes, format = 'png') => document.createTexture(`Imported Audi | ${name}`)
    .setMimeType(`image/${format}`).setImage(bytes);
  const cleanColour = await texture('de-lit trim albedo', await sharp(clean, { raw: info }).resize(2048, 2048).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer(), 'jpeg');
  const materialMap = await texture('surface roughness and metalness', await sharp(packed, { raw: { width: info.width, height: info.height, channels: 3 } }).resize(512, 512).png().toBuffer());
  const coatMap = await texture('paint clearcoat mask', await sharp(coat, { raw: { width: info.width, height: info.height, channels: 3 } }).resize(512, 512).png().toBuffer());
  const trim = source.clone().setName('Imported Audi | detailed trim').setBaseColorTexture(cleanColour)
    .setMetallicFactor(1).setRoughnessFactor(1).setMetallicRoughnessTexture(materialMap).setDoubleSided(false);
  trim.setExtension('KHR_materials_clearcoat', clearcoatExtension.createClearcoat().setClearcoatFactor(1)
    .setClearcoatRoughnessFactor(1).setClearcoatTexture(coatMap).setClearcoatRoughnessTexture(coatMap));
  const paint = document.createMaterial('Imported Audi | deep blue pearl paint')
    .setBaseColorFactor(AUDI_PAINT.color).setMetallicFactor(AUDI_PAINT.metalness).setRoughnessFactor(AUDI_PAINT.roughness).setDoubleSided(false);
  paint.setExtension('KHR_materials_clearcoat', clearcoatExtension.createClearcoat().setClearcoatFactor(1).setClearcoatRoughnessFactor(AUDI_PAINT.coatRoughness));
  const make = (name, metallic, roughness) => document.createMaterial(`Imported Audi | ${name}`)
    .setBaseColorTexture(atlas).setMetallicFactor(metallic).setRoughnessFactor(roughness).setDoubleSided(false);
  const rubber = make('tyre rubber', .015, .86);
  const alloy = make('machined graphite alloy', .88, .27);
  const chrome = make('polished chrome trim', .97, .17);
  const lens = make('headlamp and tail lamp lenses', .15, .16);
  lens.setExtension('KHR_materials_clearcoat', clearcoatExtension.createClearcoat().setClearcoatFactor(1).setClearcoatRoughnessFactor(.055));
  const brake = make('red brake caliper enamel', .32, .32);
  const cabin = make('cabin and black grille polymer', .015, .74);
  const rearGlass = document.createMaterial('Imported Audi | tailgate privacy glass')
    .setBaseColorFactor([.006, .008, .010, 1]).setMetallicFactor(0).setRoughnessFactor(.04).setDoubleSided(false);
  rearGlass.setExtension('KHR_materials_clearcoat', clearcoatExtension.createClearcoat().setClearcoatFactor(1).setClearcoatRoughnessFactor(.03));
  const sample = (u, v) => {
    const x = Math.max(0, Math.min(info.width - 1, Math.round(u * (info.width - 1))));
    const y = Math.max(0, Math.min(info.height - 1, Math.round(v * (info.height - 1))));
    return Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
  };
  return { paint, trim, rubber, alloy, chrome, lens, brake, cabin, rearGlass, sample };
}

export function finishImportedCarComponents(document, nodes, finishes) {
  const counts = {};
  for (const node of nodes) {
    const part = node.getExtras().partId;
    if (part === 'roof-box') continue;
    const mesh = node.getMesh();
    for (const primitive of [...mesh.listPrimitives()]) {
      if (primitive.getMaterial() === finishes.paint) continue;
      const position = primitive.getAttribute('POSITION'), uv = primitive.getAttribute('TEXCOORD_0');
      const xyz = position.getArray(), index = primitive.getIndices().getArray();
      const groups = new Map(), texcoord = [], meanUv = [0, 0];
      for (let offset = 0; offset < index.length; offset += 3) {
        const ids = [index[offset], index[offset + 1], index[offset + 2]];
        const center = [0, 1, 2].map(axis => ids.reduce((sum, id) => sum + xyz[id * 3 + axis] / 3, 0));
        const [x, y, z] = center, az = Math.abs(z);
        meanUv.fill(0);
        if (uv) for (const id of ids) { uv.getElement(id, texcoord); meanUv[0] += texcoord[0] / 3; meanUv[1] += texcoord[1] / 3; }
        const [r, g, b] = uv ? finishes.sample(...meanUv) : [0, 0, 0];
        const grey = (r + g + b) / 3, neutral = Math.max(r, g, b) - Math.min(r, g, b) < 45;
        let finish = 'trim';
        if (part === 'brake-kit') finish = 'brake';
        else if (part === 'wheels') {
          const axle = Math.abs(x - 1.351) < Math.abs(x + 1.376) ? 1.351 : -1.376;
          const radius = Math.hypot((x - axle) / .385, (y - .323) / .323);
          if (radius > .76 || (grey < 38 && radius > .62)) finish = 'rubber';
          else if (grey > 42 && neutral) finish = 'alloy';
          else finish = 'cabin';
        } else if ((x > 2.05 && y > .57 && y < .88 && az > .37 && az < .83)
          || (x < -2.04 && y > .65 && y < 1.04 && az > .60)) finish = 'lens';
        else if (part === 'body' && tailgateGlass(x, y, z) && !(b > r * 1.27 && b - r > 12)) finish = 'rearGlass';
        else if (part === 'exhaust' && grey > 45 && neutral) finish = 'chrome';
        else if (y > 1.34 && y < 1.49 && az > .48 && grey > 72 && neutral) finish = 'chrome';
        else if (y > .78 && az < .57 && x > -1.85 && x < 1.01) finish = 'cabin';
        else if (x > 2.15 && y < .70 && grey < 36) finish = 'cabin';
        if (!groups.has(finish)) groups.set(finish, []);
        groups.get(finish).push(...ids);
      }
      for (const [finish, indices] of groups) {
        const split = document.createPrimitive().setMode(4).setMaterial(finishes[finish]);
        for (const semantic of primitive.listSemantics()) split.setAttribute(semantic, primitive.getAttribute(semantic));
        split.setIndices(document.createAccessor(`Imported Audi | ${part} ${finish} indices`, position.getBuffer())
          .setType('SCALAR').setArray(new Uint32Array(indices)));
        mesh.addPrimitive(split); counts[finish] = (counts[finish] ?? 0) + indices.length / 3;
      }
      mesh.removePrimitive(primitive); primitive.dispose();
    }
  }
  return { paint: AUDI_PAINT, componentTriangles: counts, finishes: ['pearl clearcoat paint', 'tyre rubber', 'graphite alloy', 'polished chrome', 'lamp lenses', 'caliper enamel', 'cabin polymer', 'privacy glass', 'gloss black roof box'] };
}
