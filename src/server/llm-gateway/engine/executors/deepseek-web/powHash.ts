// DeepSeekHashV1 proof-of-work — ported from OmniRoute's lib/deepseek-pow-hash.js.
//
// Clean-room implementation derived from NIST FIPS 202 (SHA3-256). SHA3-256
// uses KECCAK-p[1600,24]; DeepSeek's chat.deepseek.com uses the same sponge
// construction but with only the last 23 of the 24 rounds ("DeepSeekHashV1").
// Every chat completion requires solving one of these puzzles first — without
// it the completion endpoint rejects the request outright.

const SHA3_256_RATE_BYTES = 136;
const SHA3_DOMAIN_SUFFIX = 0x06;
const SHA3_256_OUTPUT_BYTES = 32;
const DEEPSEEK_HASH_ROUNDS = 23;
const DIGEST_HEX_PATTERN = /^[a-f0-9]{64}$/i;

export const MAX_DEEPSEEK_POW_DIFFICULTY = 250_000;

// Indexed as x + 5*y, matching the FIPS 202 state coordinates.
const ROTATION_OFFSETS = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];

const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROUND_CONSTANTS_LOW = Uint32Array.from(ROUND_CONSTANTS, (value) => Number(value & 0xffffffffn));
const ROUND_CONSTANTS_HIGH = Uint32Array.from(ROUND_CONSTANTS, (value) => Number((value >> 32n) & 0xffffffffn));

const RHO_PI_DESTINATION_WORDS = Uint8Array.from({ length: 25 }, (_, lane) => {
  const x = lane % 5;
  const y = Math.floor(lane / 5);
  return 2 * (y + 5 * ((2 * x + 3 * y) % 5));
});
const CHI_NEXT_WORDS = Uint8Array.from({ length: 25 }, (_, lane) => {
  const x = lane % 5;
  const row = lane - x;
  return 2 * (row + ((x + 1) % 5));
});
const CHI_NEXT_NEXT_WORDS = Uint8Array.from({ length: 25 }, (_, lane) => {
  const x = lane % 5;
  const row = lane - x;
  return 2 * (row + ((x + 2) % 5));
});

/** Each 64-bit lane is stored as adjacent little-endian low/high uint32 words. */
function keccakP1600Uint32(
  state: Uint32Array,
  rhoPiState: Uint32Array,
  columnParity: Uint32Array,
  thetaMix: Uint32Array,
  roundCount: number
): void {
  const firstRound = ROUND_CONSTANTS.length - roundCount;

  for (let round = firstRound; round < ROUND_CONSTANTS.length; round++) {
    for (let x = 0; x < 5; x++) {
      const word = 2 * x;
      columnParity[word] = state[word] ^ state[word + 10] ^ state[word + 20] ^ state[word + 30] ^ state[word + 40];
      columnParity[word + 1] = state[word + 1] ^ state[word + 11] ^ state[word + 21] ^ state[word + 31] ^ state[word + 41];
    }

    for (let x = 0; x < 5; x++) {
      const previous = 2 * ((x + 4) % 5);
      const next = 2 * ((x + 1) % 5);
      const rotatedLow = (columnParity[next] << 1) | (columnParity[next + 1] >>> 31);
      const rotatedHigh = (columnParity[next + 1] << 1) | (columnParity[next] >>> 31);
      thetaMix[2 * x] = columnParity[previous] ^ rotatedLow;
      thetaMix[2 * x + 1] = columnParity[previous + 1] ^ rotatedHigh;
    }

    for (let x = 0; x < 5; x++) {
      const word = 2 * x;
      const low = thetaMix[word];
      const high = thetaMix[word + 1];
      state[word] ^= low; state[word + 1] ^= high;
      state[word + 10] ^= low; state[word + 11] ^= high;
      state[word + 20] ^= low; state[word + 21] ^= high;
      state[word + 30] ^= low; state[word + 31] ^= high;
      state[word + 40] ^= low; state[word + 41] ^= high;
    }

    rhoPiState[0] = state[0];
    rhoPiState[1] = state[1];
    for (let lane = 1; lane < 25; lane++) {
      const source = 2 * lane;
      const destination = RHO_PI_DESTINATION_WORDS[lane];
      const amount = ROTATION_OFFSETS[lane];
      const low = state[source];
      const high = state[source + 1];

      if (amount < 32) {
        rhoPiState[destination] = (low << amount) | (high >>> (32 - amount));
        rhoPiState[destination + 1] = (high << amount) | (low >>> (32 - amount));
      } else {
        const reduced = amount - 32;
        rhoPiState[destination] = (high << reduced) | (low >>> (32 - reduced));
        rhoPiState[destination + 1] = (low << reduced) | (high >>> (32 - reduced));
      }
    }

    for (let lane = 0; lane < 25; lane++) {
      const word = 2 * lane;
      const nextWord = CHI_NEXT_WORDS[lane];
      const nextNextWord = CHI_NEXT_NEXT_WORDS[lane];
      state[word] = rhoPiState[word] ^ (~rhoPiState[nextWord] & rhoPiState[nextNextWord]);
      state[word + 1] = rhoPiState[word + 1] ^ (~rhoPiState[nextWord + 1] & rhoPiState[nextNextWord + 1]);
    }

    state[0] ^= ROUND_CONSTANTS_LOW[round];
    state[1] ^= ROUND_CONSTANTS_HIGH[round];
  }
}

function absorbFullUint32Block(
  state: Uint32Array, bytes: Uint8Array, offset: number,
  rhoPiState: Uint32Array, columnParity: Uint32Array, thetaMix: Uint32Array, roundCount: number
): void {
  for (let index = 0; index < SHA3_256_RATE_BYTES; index++) {
    const word = index >>> 2;
    state[word] ^= bytes[offset + index] << ((index & 3) * 8);
  }
  keccakP1600Uint32(state, rhoPiState, columnParity, thetaMix, roundCount);
}

function parseDigestWords(digestHex: string): Uint32Array {
  const words = new Uint32Array(SHA3_256_OUTPUT_BYTES / 4);
  for (let index = 0; index < SHA3_256_OUTPUT_BYTES; index++) {
    const byte = Number.parseInt(digestHex.slice(index * 2, index * 2 + 2), 16);
    words[index >>> 2] |= byte << ((index & 3) * 8);
  }
  return words;
}

/** Search `prefix + nonce` for the first value whose DeepSeekHashV1 digest
 * equals `challenge`. Returns -1 if no nonce below `difficulty` matches. */
export function findDeepSeekPowNonce(prefix: string, challenge: string, difficulty: number): number {
  if (typeof prefix !== "string") throw new TypeError("DeepSeek PoW prefix must be a string");
  if (!DIGEST_HEX_PATTERN.test(challenge)) throw new TypeError("DeepSeek PoW challenge must be a 64-character hex digest");
  if (!Number.isSafeInteger(difficulty) || difficulty < 1 || difficulty > MAX_DEEPSEEK_POW_DIFFICULTY) {
    throw new RangeError(`DeepSeek PoW difficulty must be an integer from 1 to ${MAX_DEEPSEEK_POW_DIFFICULTY}`);
  }

  const prefixBytes = new TextEncoder().encode(prefix);
  const baseState = new Uint32Array(50);
  const rhoPiState = new Uint32Array(50);
  const columnParity = new Uint32Array(10);
  const thetaMix = new Uint32Array(10);
  let prefixOffset = 0;

  while (prefixOffset + SHA3_256_RATE_BYTES <= prefixBytes.length) {
    absorbFullUint32Block(baseState, prefixBytes, prefixOffset, rhoPiState, columnParity, thetaMix, DEEPSEEK_HASH_ROUNDS);
    prefixOffset += SHA3_256_RATE_BYTES;
  }

  const tailLength = prefixBytes.length - prefixOffset;
  const tailWords = new Uint32Array(Math.ceil(tailLength / 4));
  for (let index = 0; index < tailLength; index++) {
    tailWords[index >>> 2] ^= prefixBytes[prefixOffset + index] << ((index & 3) * 8);
  }

  const targetWords = parseDigestWords(challenge.toLowerCase());
  const state = new Uint32Array(50);

  nonceLoop: for (let nonce = 0; nonce < difficulty; nonce++) {
    state.set(baseState);
    for (let word = 0; word < tailWords.length; word++) state[word] ^= tailWords[word];

    let position = tailLength;
    const nonceText = String(nonce);
    for (let index = 0; index < nonceText.length; index++) {
      state[position >>> 2] ^= nonceText.charCodeAt(index) << ((position & 3) * 8);
      position += 1;
      if (position === SHA3_256_RATE_BYTES) {
        keccakP1600Uint32(state, rhoPiState, columnParity, thetaMix, DEEPSEEK_HASH_ROUNDS);
        position = 0;
      }
    }

    state[position >>> 2] ^= SHA3_DOMAIN_SUFFIX << ((position & 3) * 8);
    state[(SHA3_256_RATE_BYTES - 1) >>> 2] ^= 0x80 << 24;
    keccakP1600Uint32(state, rhoPiState, columnParity, thetaMix, DEEPSEEK_HASH_ROUNDS);

    for (let word = 0; word < targetWords.length; word++) {
      if (state[word] !== targetWords[word]) continue nonceLoop;
    }
    return nonce;
  }

  return -1;
}

// ponytail: solved synchronously on the request thread (no worker_threads) —
// difficulty is capped at MAX_DEEPSEEK_POW_DIFFICULTY (250k KECCAK permutations,
// sub-second to a few seconds in practice). Move to a worker if this measurably
// blocks concurrent requests under load; a separate .mjs worker file adds
// Next.js bundling risk (path resolution across build/deploy) this project
// doesn't yet have infrastructure for.
export function solveDeepSeekPow(algorithm: string, challenge: string, salt: string, difficulty: number, expireAt: number): number {
  if (algorithm !== "DeepSeekHashV1") throw new Error(`Unsupported DeepSeek PoW algorithm: ${algorithm}`);
  if (!DIGEST_HEX_PATTERN.test(challenge)) throw new Error("DeepSeek PoW challenge must be a 64-character SHA3-256 hex digest");
  if (typeof salt !== "string" || salt.length === 0 || salt.length > 1024) throw new Error("DeepSeek PoW salt must contain 1-1024 characters");
  if (!Number.isSafeInteger(expireAt) || expireAt < 0) throw new Error("DeepSeek PoW expiry must be a non-negative safe integer");
  const prefix = `${salt}_${expireAt}_`;
  return findDeepSeekPowNonce(prefix, challenge.toLowerCase(), difficulty);
}
