import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/local-auth';

export const runtime = 'nodejs';
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const formats = {
  'image/jpeg': { extension: 'jpg', matches: (bytes: Buffer) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  'image/png': { extension: 'png', matches: (bytes: Buffer) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) },
  'image/webp': { extension: 'webp', matches: (bytes: Buffer) => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' },
} as const;

export async function POST(request: Request) {
  if ((await currentUser())?.role !== 'admin') {
    return NextResponse.json({ error: 'Accès administrateur requis.' }, { status: 403 });
  }
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: 'Fichier d’image invalide.' }, { status: 400 }); }
  const image = form.get('image');
  if (!(image instanceof File)) return NextResponse.json({ error: 'Sélectionne une image à importer.' }, { status: 400 });
  if (image.size === 0 || image.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'L’image doit peser entre 1 octet et 5 Mo.' }, { status: 400 });
  const format = formats[image.type as keyof typeof formats];
  if (!format) return NextResponse.json({ error: 'Formats acceptés : JPEG, PNG et WebP.' }, { status: 415 });
  const bytes = Buffer.from(await image.arrayBuffer());
  if (!format.matches(bytes)) return NextResponse.json({ error: 'Le contenu du fichier ne correspond pas à son format image.' }, { status: 415 });
  const filename = `${randomUUID()}.${format.extension}`;
  // Store runtime uploads in the persistent Docker data volume, not in the
  // build image's public directory.
  const directory = join(process.cwd(), 'data', 'uploads', 'cards');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, filename), bytes, { flag: 'wx' });
    return NextResponse.json({ imageUrl: `/uploads/cards/${filename}` });
  } catch (error) {
    console.error('Card illustration upload failed:', error);
    return NextResponse.json({ error: 'Impossible d’enregistrer cette illustration sur le disque.' }, { status: 500 });
  }
}
