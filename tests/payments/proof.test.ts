import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_PROOF_BYTES,
  MAX_PROOF_EDGE,
  MAX_PROOF_FILES,
  checkProofFile,
  checkProofFiles,
  describeBytes,
  downscaleTo,
  extensionFor,
  isAcceptedProofType,
  proofStoragePath,
} from '../../src/lib/proof.ts'

const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: 'IMG_0042.jpg',
  type: 'image/jpeg',
  size: 800_000,
  ...over,
})

describe('what counts as proof', () => {
  test('a phone screenshot is fine', () => {
    assert.equal(checkProofFile(file()).ok, true)
  })

  test('a PDF of the chat confirming it is fine too', () => {
    assert.equal(checkProofFile(file({ name: 'chat.pdf', type: 'application/pdf' })).ok, true)
  })

  test('the formats a phone actually produces are all accepted', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      assert.equal(isAcceptedProofType(type), true, `${type} should be accepted`)
    }
  })

  test('a spreadsheet or a video is refused, and the message names the file', () => {
    const result = checkProofFile(file({ name: 'ledger.xlsx', type: 'application/vnd.ms-excel' }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /"ledger\.xlsx" is not an image or a PDF/)
  })

  test('an empty file is refused rather than stored as proof of nothing', () => {
    const result = checkProofFile(file({ size: 0 }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /is empty/)
  })

  test('a file over the limit says its size and the limit', () => {
    const result = checkProofFile(file({ size: MAX_PROOF_BYTES + 1 }))
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(result.error, /4\.0 MB/)
      assert.match(result.error, /The limit is/)
    }
  })

  test('a file exactly at the limit is accepted — the boundary is inclusive', () => {
    assert.equal(checkProofFile(file({ size: MAX_PROOF_BYTES })).ok, true)
  })
})

describe('several files per payment', () => {
  test('the screenshot plus the chat is the normal case', () => {
    const result = checkProofFiles([file(), file({ name: 'chat.pdf', type: 'application/pdf' })])
    assert.equal(result.ok, true)
  })

  test('no files at all is fine — proof is optional, only flagged', () => {
    assert.equal(checkProofFiles([]).ok, true)
  })

  test('too many at once is refused', () => {
    const many = Array.from({ length: MAX_PROOF_FILES + 1 }, () => file())
    const result = checkProofFiles(many)
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, new RegExp(String(MAX_PROOF_FILES)))
  })

  test('one bad file refuses the batch, naming that file', () => {
    const result = checkProofFiles([file(), file({ name: 'clip.mov', type: 'video/quicktime' })])
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /clip\.mov/)
  })
})

describe('where a file is kept', () => {
  test('the path starts with the account, so one account cannot guess another’s', () => {
    const path = proofStoragePath('user-1', 'pay-9', 'abc123', 'image/jpeg')
    assert.equal(path, 'user-1/pay-9/abc123.jpg')
  })

  test('the uploaded filename is not used — two screenshots really are both IMG_0042', () => {
    const a = proofStoragePath('u', 'p', 'id-one', 'image/png')
    const b = proofStoragePath('u', 'p', 'id-two', 'image/png')
    assert.notEqual(a, b)
  })

  test('the extension follows the type, not the name', () => {
    assert.equal(extensionFor('application/pdf'), 'pdf')
    assert.equal(extensionFor('image/jpeg'), 'jpg')
  })

  test('an unknown type still produces a usable path rather than throwing', () => {
    assert.equal(proofStoragePath('u', 'p', 'x', 'application/whatever'), 'u/p/x.bin')
  })
})

describe('shrinking an image before it is stored', () => {
  test('a phone camera photo comes down to the long edge', () => {
    const size = downscaleTo(4032, 3024)
    assert.deepEqual(size, { width: MAX_PROOF_EDGE, height: 1200 })
  })

  test('a tall screenshot shrinks on its height', () => {
    const size = downscaleTo(1170, 2532)
    assert.equal(size?.height, MAX_PROOF_EDGE)
    assert.ok(size!.width < 1170)
  })

  test('the shape is kept', () => {
    const size = downscaleTo(4000, 2000)
    assert.equal(size!.width / size!.height, 2)
  })

  test('an already-small image is left alone rather than re-encoded', () => {
    assert.equal(downscaleTo(800, 600), null)
    assert.equal(downscaleTo(MAX_PROOF_EDGE, 900), null)
  })

  test('a zero-sized image does not divide by zero', () => {
    assert.equal(downscaleTo(0, 0), null)
  })

  test('an extreme panorama still keeps at least one pixel of height', () => {
    const size = downscaleTo(20_000, 3)
    assert.ok(size!.height >= 1)
  })
})

describe('sizes written for a person', () => {
  test('bytes, kilobytes and megabytes', () => {
    assert.equal(describeBytes(512), '512 bytes')
    assert.equal(describeBytes(2048), '2 KB')
    assert.equal(describeBytes(2_500_000), '2.4 MB')
  })
})
