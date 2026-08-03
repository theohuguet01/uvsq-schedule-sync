import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmod, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeAtomic } from '../src/writeAtomic.js'

async function makeTmpDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'uvsq-schedule-sync-test-'))
  t.after(async () => {
    await chmod(dir, 0o700).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

test('écrit le contenu et ne laisse aucun fichier temporaire', async (t) => {
  const dir = await makeTmpDir(t)
  const target = join(dir, 'edt.ics')

  await writeAtomic(target, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')

  const content = await readFile(target, 'utf8')
  assert.equal(content, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')

  const files = await readdir(dir)
  assert.deepEqual(files, ['edt.ics'])
})

test('crée le répertoire parent si nécessaire', async (t) => {
  const dir = await makeTmpDir(t)
  const target = join(dir, 'nested', 'deep', 'edt.ics')

  await writeAtomic(target, 'contenu')

  const content = await readFile(target, 'utf8')
  assert.equal(content, 'contenu')
})

test('remplace intégralement le contenu précédent, sans fichier temporaire résiduel', async (t) => {
  const dir = await makeTmpDir(t)
  const target = join(dir, 'edt.ics')

  await writeAtomic(target, 'version 1')
  await writeAtomic(target, 'version 2')

  const content = await readFile(target, 'utf8')
  assert.equal(content, 'version 2')

  const files = await readdir(dir)
  assert.deepEqual(files, ['edt.ics'])
})

test('en cas d\'échec, le fichier déjà publié n\'est pas touché et le temporaire est nettoyé', async (t) => {
  const dir = await makeTmpDir(t)
  const target = join(dir, 'edt.ics')

  await writeAtomic(target, 'version publiée')

  // Retire le droit d'écriture sur le répertoire : impossible de créer le
  // fichier temporaire, ce qui doit faire échouer writeAtomic sans toucher
  // au fichier déjà publié.
  await chmod(dir, 0o500)

  await assert.rejects(() => writeAtomic(target, 'version qui échoue'))

  await chmod(dir, 0o700)
  const content = await readFile(target, 'utf8')
  assert.equal(content, 'version publiée')

  const files = await readdir(dir)
  assert.deepEqual(files, ['edt.ics'])
})
