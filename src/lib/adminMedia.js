// Owner uploads to Supabase Storage. Buckets enforce type and size again server-side
// (see supabase/migrations), and only project owners may write under <project id>/.

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const MODEL_MAX_BYTES = 25 * 1024 * 1024;
export const GALLERY_MAX = 12;

const safeName = (name) => name.replace(/[^\w.-]/g, '_').slice(-80);

export function imageProblem(file) {
  if (!IMAGE_TYPES.includes(file?.type)) return `${file?.name ?? 'File'}: use JPG, PNG or WebP.`;
  if (file.size > IMAGE_MAX_BYTES) return `${file.name}: images must be under 5 MB.`;
  return null;
}

export function modelProblem(file) {
  if (!file || !/\.glb$/i.test(file.name)) return 'Choose a .glb file (binary glTF). Export from Blender with File → Export → glTF 2.0 (.glb).';
  if (file.size > MODEL_MAX_BYTES) return `${file.name} is over 25 MB. Compress it first (see docs/PART-FUNDING.md).`;
  return null;
}

/** Upload one image to project-media; returns its public URL. */
export async function uploadImage(supabase, projectId, folder, file) {
  const problem = imageProblem(file);
  if (problem) throw new Error(problem);
  const path = `${projectId}/${folder}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error } = await supabase.storage.from('project-media').upload(path, file, { contentType: file.type });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return supabase.storage.from('project-media').getPublicUrl(path).data.publicUrl;
}

/** Upload one .glb to project-models; returns its public URL. */
export async function uploadModel(supabase, projectId, partSlug, file) {
  const problem = modelProblem(file);
  if (problem) throw new Error(problem);
  const path = `${projectId}/parts/${partSlug}/${crypto.randomUUID()}.glb`;
  // Browsers usually report .glb with an empty type, so it is set explicitly.
  const { error } = await supabase.storage.from('project-models').upload(path, file, { contentType: 'model/gltf-binary' });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return supabase.storage.from('project-models').getPublicUrl(path).data.publicUrl;
}
