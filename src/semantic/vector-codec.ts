export function encodeFloat32Vector(vector: number[]): Buffer {
  const buffer = Buffer.allocUnsafe(vector.length * Float32Array.BYTES_PER_ELEMENT);
  vector.forEach((value, index) => {
    buffer.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT);
  });
  return buffer;
}

export function decodeFloat32Vector(value: unknown): number[] {
  const bytes = bytesFromBlob(value);
  if (!bytes.length || bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    return [];
  }
  const result: number[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
    result.push(Number(bytes.readFloatLE(offset).toFixed(6)));
  }
  return result;
}

export function encodeVectorJsonAsFloat32Blob(value: unknown): Buffer {
  if (typeof value !== "string" || !value) {
    return encodeFloat32Vector([]);
  }
  const parsed = JSON.parse(value) as unknown;
  const vector = Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number") : [];
  return encodeFloat32Vector(vector);
}

function bytesFromBlob(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return Buffer.alloc(0);
}
