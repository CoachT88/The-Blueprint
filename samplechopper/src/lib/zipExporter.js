import JSZip from 'jszip'

/**
 * Bundle an array of named Blobs into a ZIP and trigger a browser download.
 *
 * WAVs do not compress well, so we use STORE (no compression) for speed.
 *
 * @param {{ name: string, blob: Blob }[]} files
 * @param {string} zipName  - Download filename, e.g. "mysample_chops.zip"
 * @returns {Promise<void>}
 */
export async function exportZip(files, zipName = 'chops.zip') {
  const zip = new JSZip()

  for (const { name, blob } of files) {
    zip.file(name, blob)
  }

  const content = await zip.generateAsync({
    type: 'blob',
    compression: 'STORE',   // skip deflate — WAVs don't shrink
  })

  // Trigger download via a temporary anchor
  const url = URL.createObjectURL(content)
  const a   = document.createElement('a')
  a.href     = url
  a.download = zipName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  // Revoke after the download has had time to start
  setTimeout(() => URL.revokeObjectURL(url), 15_000)
}
