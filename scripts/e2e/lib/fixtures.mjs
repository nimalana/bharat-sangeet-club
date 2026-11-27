// Small, valid files for uploads. Each call returns bytes unique to the caller (a random tail
// where the format allows one), so a signed-URL download can be compared with what was uploaded.
import { createHash, randomBytes } from "node:crypto";

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

// 1x1 PNG.
export function png() {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
}

// A minimal PDF with a unique comment, so every upload is distinct.
export function pdf(label = "e2e") {
  return Buffer.from(`%PDF-1.1\n%${label} ${randomBytes(6).toString("hex")}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
}

// A short mono WAV of silence plus a unique LIST chunk-free tail (players ignore trailing bytes).
export function wav(seconds = 0.25) {
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate * seconds);
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data, randomBytes(8)]);
}

export function text(label = "e2e") {
  return Buffer.from(`${label}\n${randomBytes(8).toString("hex")}\n`);
}

// What a browser File looks like to supabase-js (it uploads File objects as multipart form data).
export function asFile(buffer, name, type) {
  return new File([buffer], name, { type });
}
