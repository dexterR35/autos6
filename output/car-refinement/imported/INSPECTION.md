# Uploaded Audi model

The original `C:/Users/Dexter/Downloads/model.glb` is preserved. The model has
more convincing rounded wings, bumper contours, door moldings and touring-box
details than the first procedural car. Its source generator is Tripo3D.

- Original: 30,335,164 bytes, 924,442 triangles, 504,352 vertices.
- One connected mesh, one material, one embedded 4096 × 4096 JPEG atlas.
- Normals and UVs are valid. There are small topology defects and uneven surfaces.
- Glazing is not a separate translucent surface. Paint, tyres, trim and lamps
  share the same material; there are no interactive part identifiers.

`model-web.glb` is a non-destructive preview derivative: 5,735,936 bytes,
295,819 triangles and one draw call. The original JPEG bytes are preserved.
The derivative uses Meshopt compression with 16-bit positions, 14-bit normals
and 16-bit UVs. It is normalized to the existing garage envelope, 4.797 m long,
1.85 m high including the roof box, and 2.10 m wide including mirrors. These
are scene-fit dimensions, not verified factory measurements.

The model is a useful shape reference and potential replacement base. A complete
interactive replacement still needs glazing, surface/material separation and
part identifiers. The application continues using its corrected editable model;
the uploaded model is available in the development comparison preview.

Regenerate with `node scripts/optimize-imported-car.mjs --input PATH`.
