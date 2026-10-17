// Bounded Compound File reader: only root Word streams are inspected. Never
// execute document content or trust directory sizes/linked lists from the file.
export function isOleWord(data: Buffer): boolean {
  try {
    const fail = (): never => {
      throw new Error('Invalid compound file');
    };
    if (data.length < 512 || data.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1')
      return false;
    const major = data.readUInt16LE(26);
    const sectorSize = 2 ** data.readUInt16LE(30);
    if (
      !((major === 3 && sectorSize === 512) || (major === 4 && sectorSize === 4096)) ||
      data.readUInt16LE(28) !== 0xfffe ||
      data.readUInt16LE(32) !== 6 ||
      data.readUInt32LE(56) !== 4096
    )
      return false;
    if (data.length % sectorSize) return false;
    const sectorCount = data.length / sectorSize - 1;
    const sector = (id: number) => {
      if (!Number.isInteger(id) || id < 0 || id >= sectorCount) fail();
      return data.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);
    };
    const fatCount = data.readUInt32LE(44);
    if (!fatCount || fatCount > sectorCount) return false;
    const fatIds: number[] = [];
    for (let offset = 76; offset < 512; offset += 4) {
      const id = data.readInt32LE(offset);
      if (id >= 0) fatIds.push(id);
    }
    let difat = data.readInt32LE(68);
    const seenDifat = new Set<number>();
    const difatCount = data.readUInt32LE(72);
    if (difatCount > sectorCount) return false;
    for (let i = 0; i < difatCount; i++) {
      if (seenDifat.has(difat)) fail();
      seenDifat.add(difat);
      const block = sector(difat);
      for (let offset = 0; offset < sectorSize - 4; offset += 4) {
        const id = block.readInt32LE(offset);
        if (id >= 0) fatIds.push(id);
      }
      difat = block.readInt32LE(sectorSize - 4);
    }
    if (fatIds.length !== fatCount || new Set(fatIds).size !== fatCount) return false;
    const fat = new Int32Array((fatCount * sectorSize) / 4);
    for (let i = 0; i < fatIds.length; i++) {
      const block = sector(fatIds[i]);
      for (let j = 0; j < sectorSize / 4; j++)
        fat[(i * sectorSize) / 4 + j] = block.readInt32LE(j * 4);
    }
    const chain = (start: number, table: Int32Array, get: (id: number) => Buffer, max: number) => {
      const parts: Buffer[] = [],
        visited = new Set<number>();
      let id = start,
        bytes = 0;
      while (id !== -2) {
        if (id < 0 || id >= table.length || visited.has(id)) fail();
        visited.add(id);
        const block = get(id);
        bytes += block.length;
        if (bytes > max) fail();
        parts.push(block);
        id = table[id];
      }
      return Buffer.concat(parts);
    };
    const directory = chain(data.readInt32LE(48), fat, sector, data.length);
    if (directory.length % 128) return false;
    const entryCount = directory.length / 128;
    const entry = (id: number) => {
      if (id < 0 || id >= entryCount) fail();
      const block = directory.subarray(id * 128, (id + 1) * 128);
      const nameLength = block.readUInt16LE(64);
      if (nameLength < 2 || nameLength > 64 || nameLength % 2 || block.readUInt16LE(nameLength - 2))
        fail();
      const size = Number(block.readBigUInt64LE(120));
      if (!Number.isSafeInteger(size) || size > data.length) fail();
      return {
        name: block.toString('utf16le', 0, nameLength - 2),
        type: block[66],
        left: block.readInt32LE(68),
        right: block.readInt32LE(72),
        child: block.readInt32LE(76),
        start: block.readInt32LE(116),
        size,
      };
    };
    const root = entry(0);
    if (root.type !== 5) return false;
    const streams = new Map<string, ReturnType<typeof entry>>();
    const todo = [root.child],
      visited = new Set<number>();
    while (todo.length) {
      const id = todo.pop()!;
      if (id === -1) continue;
      if (visited.has(id)) fail();
      visited.add(id);
      const item = entry(id);
      if (streams.has(item.name)) fail();
      streams.set(item.name, item);
      todo.push(item.left, item.right);
    }
    const word = streams.get('WordDocument');
    if (!word || word.type !== 2 || word.size < 32) return false;
    let miniRoot: Buffer | undefined, miniFat: Int32Array | undefined;
    const stream = (item: ReturnType<typeof entry>) => {
      if (item.size >= 4096) {
        const value = chain(item.start, fat, sector, data.length);
        if (value.length < item.size) fail();
        return value.subarray(0, item.size);
      }
      if (!miniRoot) {
        miniRoot = chain(root.start, fat, sector, data.length).subarray(0, root.size);
        const mini = chain(data.readInt32LE(60), fat, sector, data.length);
        miniFat = new Int32Array(mini.length / 4);
        for (let i = 0; i < miniFat.length; i++) miniFat[i] = mini.readInt32LE(i * 4);
      }
      const value = chain(
        item.start,
        miniFat!,
        (id) => {
          if (id * 64 + 64 > miniRoot!.length) fail();
          return miniRoot!.subarray(id * 64, id * 64 + 64);
        },
        data.length,
      );
      if (value.length < item.size) fail();
      return value.subarray(0, item.size);
    };
    const fib = stream(word);
    const table = streams.get(fib.readUInt16LE(10) & 0x200 ? '1Table' : '0Table');
    if (
      fib.readUInt16LE(0) !== 0xa5ec ||
      fib.readUInt16LE(2) < 0x65 ||
      fib.readUInt16LE(2) > 0x112 ||
      !table ||
      table.type !== 2 ||
      !table.size
    )
      return false;
    stream(table);
    return fib.readUInt32LE(24) <= fib.readUInt32LE(28) && fib.readUInt32LE(28) <= fib.length;
  } catch {
    return false;
  }
}
