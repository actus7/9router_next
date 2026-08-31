// Minimal protobuf wire-format codec — just enough to mutate specific fields
// inside a captured Meta AI WS prompt-frame template (see wsFrames.ts) without
// a .proto schema. Ported verbatim from OmniRoute's muse-spark-web.ts.

export interface ProtoField {
  number: number;
  wireType: number;
  value: Uint8Array | number | bigint;
}

export function encodeVarint(value: number): Uint8Array {
  // BigInt arithmetic avoids 32-bit truncation from JS bitwise operators.
  let v = BigInt(value);
  const out: number[] = [];
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v & 0x7fn));
  return new Uint8Array(out);
}

export function decodeVarint(data: Uint8Array, offset: number): [number, number] {
  let shift = 0;
  let value = 0;
  let off = offset;
  while (true) {
    const byte = data[off++];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return [value >>> 0, off];
    shift += 7;
    if (shift > 63) throw new Error("Varint too long");
  }
}

export function parseProtoFields(data: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < data.length) {
    const [tag, next] = decodeVarint(data, offset);
    offset = next;
    const number = tag >> 3;
    const wireType = tag & 0x07;
    if (wireType === 0) {
      const [value, n] = decodeVarint(data, offset);
      offset = n;
      fields.push({ number, wireType, value });
    } else if (wireType === 1) {
      const view = new DataView(data.buffer, data.byteOffset + offset, 8);
      fields.push({ number, wireType, value: view.getBigUint64(0, true) });
      offset += 8;
    } else if (wireType === 2) {
      const [len, n] = decodeVarint(data, offset);
      offset = n;
      fields.push({ number, wireType, value: data.slice(offset, offset + len) });
      offset += len;
    } else if (wireType === 5) {
      const view = new DataView(data.buffer, data.byteOffset + offset, 4);
      fields.push({ number, wireType, value: view.getUint32(0, true) });
      offset += 4;
    } else {
      throw new Error(`Unsupported wire type: ${wireType}`);
    }
  }
  return fields;
}

export function serializeProtoFields(fields: ProtoField[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of fields) {
    const tag = (f.number << 3) | f.wireType;
    parts.push(encodeVarint(tag));
    if (f.wireType === 0) {
      parts.push(encodeVarint(Number(f.value)));
    } else if (f.wireType === 1) {
      const buf = new Uint8Array(8);
      if (f.value instanceof Uint8Array) {
        throw new Error(`serializeProtoFields: wire type 1 field ${f.number} has non-numeric value`);
      }
      new DataView(buf.buffer).setBigUint64(0, BigInt(f.value), true);
      parts.push(buf);
    } else if (f.wireType === 2) {
      const raw = f.value instanceof Uint8Array ? f.value : new TextEncoder().encode(String(f.value));
      parts.push(encodeVarint(raw.length));
      parts.push(raw);
    } else if (f.wireType === 5) {
      const buf = new Uint8Array(4);
      new DataView(buf.buffer).setUint32(0, Number(f.value), true);
      parts.push(buf);
    }
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

export function findProtoField(fields: ProtoField[], number: number): ProtoField | undefined {
  return fields.find((f) => f.number === number);
}

/** Walks a dotted field-number path into nested length-delimited (wireType 2)
 * submessages and applies `mutator` to the field found at the path's end,
 * re-serializing every ancestor submessage on the way back out. */
export function traverseAndMutate(fields: ProtoField[], path: number[], mutator: (field: ProtoField) => void): boolean {
  if (path.length === 0) return false;
  const field = findProtoField(fields, path[0]);
  if (!field || !(field.value instanceof Uint8Array)) return false;
  if (path.length === 1) {
    mutator(field);
    return true;
  }
  const nested = parseProtoFields(field.value);
  if (traverseAndMutate(nested, path.slice(1), mutator)) {
    field.value = serializeProtoFields(nested);
    return true;
  }
  return false;
}
