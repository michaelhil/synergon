// The run name of an app source (§3.2): worked out from the live scene id and the source's random key, so nothing
// secret is stored and a block copied into another scene never joins the first scene's runs. Synchronous and pure JS
// on purpose: crypto.subtle is asynchronous and absent on plain-HTTP LAN pages. Identical in server and viewer.
import { LIVE } from "./room-content.ts";

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 (FIPS 180-4) of the bytes. */
export function sha256(bytes: Uint8Array): Uint8Array {
  const bits = bytes.length * 8, padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      w[i] = (w[i - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
    }
    const s = Array.from(h);
    for (let i = 0; i < 64; i++) {
      const [a, b, c, d, e, f, g, k] = s as [number, number, number, number, number, number, number, number];
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      s[7] = g; s[6] = f; s[5] = e; s[4] = (d + t1) >>> 0; s[3] = c; s[2] = b; s[1] = a; s[0] = (t1 + t2) >>> 0;
    }
    for (let i = 0; i < 8; i++) h[i] = h[i]! + s[i]!;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]!);
  return out;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** RFC 4648 base32, alphabet lower-cased, no padding. */
export function base32(bytes: Uint8Array): string {
  let out = "", buffer = 0, held = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    held += 8;
    while (held >= 5) { out += ALPHABET[(buffer >>> (held - 5)) & 31]; held -= 5; }
  }
  if (held > 0) out += ALPHABET[(buffer << (5 - held)) & 31];
  return out;
}

/** base32(sha256(utf8("live-surfaces/1\n" + sceneId + "\n" + key))).slice(0, 26). sceneId is the live scene id. */
export function runName(sceneId: string, key: string): string {
  return base32(sha256(new TextEncoder().encode("live-surfaces/1\n" + sceneId + "\n" + key))).slice(0, LIVE.nameLength);
}

/** A fresh run key: 10 base32 characters from crypto.getRandomValues (each byte's low 5 bits, so uniform). */
export function newKey(): string {
  const r = crypto.getRandomValues(new Uint8Array(LIVE.keyLength));
  let out = "";
  for (const byte of r) out += ALPHABET[byte & 31];
  return out;
}
