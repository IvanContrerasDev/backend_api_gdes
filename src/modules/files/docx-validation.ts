import { open, Entry, ZipFile } from 'yauzl';
import { SaxesParser } from 'saxes';
import { Readable } from 'node:stream';

const contentNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const strictWordNamespace = 'http://purl.oclc.org/ooxml/wordprocessingml/main';

function xmlRoot(
  bytes: Buffer,
  expected: string,
  namespace: string[],
  mode?: 'content' | 'relationships',
) {
  let root = false,
    depth = 0,
    validOverride = false,
    validRelationship = false,
    validBody = false;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => {
    throw new Error('DTD not allowed');
  });
  parser.on('error', (error) => {
    throw error;
  });
  parser.on('opentag', (tag) => {
    if (++depth > 128) throw new Error('XML nesting limit');
    if (!root) {
      if (tag.local !== expected || !namespace.includes(tag.uri)) throw new Error('Wrong XML root');
      root = true;
    }
    if (
      mode === 'content' &&
      depth === 2 &&
      tag.uri === contentNamespace &&
      tag.local === 'Override'
    ) {
      const attrs = Object.values(tag.attributes);
      const part = attrs.find((a) => a.local === 'PartName')?.value;
      const type = attrs.find((a) => a.local === 'ContentType')?.value;
      if (
        part === '/word/document.xml' &&
        type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
      )
        validOverride = true;
    }
    if (mode === 'relationships' && depth === 2 && tag.local === 'Relationship') {
      const attrs = Object.values(tag.attributes);
      const type = attrs.find((a) => a.local === 'Type')?.value;
      const target = attrs.find((a) => a.local === 'Target')?.value;
      const external = attrs.find((a) => a.local === 'TargetMode')?.value;
      if (
        [
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
          'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
        ].includes(type ?? '') &&
        ['word/document.xml', '/word/document.xml'].includes(target ?? '') &&
        external !== 'External'
      )
        validRelationship = true;
    }
    if (
      expected === 'document' &&
      depth === 2 &&
      tag.local === 'body' &&
      namespace.includes(tag.uri)
    )
      validBody = true;
  });
  parser.on('closetag', () => {
    depth--;
  });
  const signature = bytes.subarray(0, 2).toString('hex');
  const encoding = ['fffe', '3c00'].includes(signature)
    ? 'utf-16le'
    : ['feff', '003c'].includes(signature)
      ? 'utf-16be'
      : 'utf-8';
  parser.write(new TextDecoder(encoding, { fatal: true }).decode(bytes)).close();
  return (
    root &&
    (mode !== 'content' || validOverride) &&
    (mode !== 'relationships' || validRelationship) &&
    (expected !== 'document' || validBody)
  );
}

export async function isDocx(path: string): Promise<boolean> {
  let zip: ZipFile | undefined;
  try {
    zip = await new Promise<ZipFile>((resolve, reject) =>
      open(
        path,
        { lazyEntries: true, validateEntrySizes: true, strictFileNames: true, autoClose: false },
        (error, file) => (error || !file ? reject(error) : resolve(file)),
      ),
    );
    if (zip.entryCount > 5000) return false;
    let size = 0;
    const names = new Set<string>();
    const entries: Entry[] = [];
    await new Promise<void>((resolve, reject) => {
      zip!.on('error', reject);
      zip!.on('end', resolve);
      zip!.on('entry', (entry: Entry) => {
        size += entry.uncompressedSize;
        if (
          size > 200 * 1024 * 1024 ||
          entry.uncompressedSize > 20 * 1024 * 1024 ||
          names.has(entry.fileName) ||
          entry.generalPurposeBitFlag & 1
        ) {
          reject(new Error('ZIP limit'));
          return;
        }
        names.add(entry.fileName);
        if (['[Content_Types].xml', 'word/document.xml', '_rels/.rels'].includes(entry.fileName))
          entries.push(entry);
        zip!.readEntry();
      });
      zip!.readEntry();
    });
    const read = async (entry: Entry) => {
      const stream = await new Promise<Readable>((resolve, reject) =>
        zip!.openReadStream(entry, (error, value) =>
          error || !value ? reject(error) : resolve(value),
        ),
      );
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of stream) {
        const buffer = Buffer.from(chunk as Uint8Array);
        bytes += buffer.length;
        if (bytes > 20 * 1024 * 1024) {
          stream.destroy();
          throw new Error('XML size limit');
        }
        chunks.push(buffer);
      }
      return Buffer.concat(chunks);
    };
    const types = entries.find((entry) => entry.fileName === '[Content_Types].xml');
    const document = entries.find((entry) => entry.fileName === 'word/document.xml');
    const relations = entries.find((entry) => entry.fileName === '_rels/.rels');
    if (!types || !document || !relations) return false;
    return (
      xmlRoot(await read(types), 'Types', [contentNamespace], 'content') &&
      xmlRoot(await read(document), 'document', [wordNamespace, strictWordNamespace]) &&
      xmlRoot(
        await read(relations),
        'Relationships',
        ['http://schemas.openxmlformats.org/package/2006/relationships'],
        'relationships',
      )
    );
  } catch {
    return false;
  } finally {
    zip?.close();
  }
}
