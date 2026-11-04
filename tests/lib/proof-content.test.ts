import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { proofContentMatches } from '../../src/lib/proof.ts'

const bytes = (...b: number[]) => new Uint8Array(b)
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))

describe('a proof file is what its type says', () => {
  test('a real PNG', () => assert.equal(proofContentMatches('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)), true))
  test('a real JPEG', () => assert.equal(proofContentMatches('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0)), true))
  test('a real PDF', () => assert.equal(proofContentMatches('application/pdf', ascii('%PDF-1.7')), true))
  test('a real WebP', () => assert.equal(proofContentMatches('image/webp', ascii('RIFF\0\0\0\0WEBPVP8 ')), true))
  test('an iPhone HEIC', () => assert.equal(proofContentMatches('image/heic', ascii('\0\0\0\x18ftypheic')), true))
  test('a text file renamed .png is refused', () => assert.equal(proofContentMatches('image/png', ascii('this is not an image')), false))
  test('a JPEG labelled PNG is refused', () => assert.equal(proofContentMatches('image/png', bytes(0xff, 0xd8, 0xff, 0xe0)), false))
  test('an empty file is refused', () => assert.equal(proofContentMatches('image/jpeg', bytes()), false))
})
