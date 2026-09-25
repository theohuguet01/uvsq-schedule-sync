import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const DISCLAIMER = 'Projet étudiant indépendant, non affilié à l\'UVSQ ni à l\'Université Paris-Saclay.'

test('chaque page HTML publique mentionne la non-affiliation dans son pied de page', async () => {
  const pages = (await readdir(PUBLIC_DIR)).filter((file) => file.endsWith('.html'))
  assert.ok(pages.length > 0)

  for (const page of pages) {
    const html = await readFile(join(PUBLIC_DIR, page), 'utf8')
    const footer = html.match(/<footer>([\s\S]*?)<\/footer>/)
    assert.ok(footer, `${page} : pied de page introuvable`)
    assert.ok(footer[1].includes(DISCLAIMER), `${page} : mention de non-affiliation absente du pied de page`)
  }
})

test('les pages d\'inscription affichent l\'encart "service non officiel" au-dessus du formulaire', async () => {
  for (const page of ['index.html', 'inscription.html']) {
    const html = await readFile(join(PUBLIC_DIR, page), 'utf8')
    const notice = html.indexOf('<p class="notice">Service non officiel')
    assert.ok(notice !== -1, `${page} : encart absent`)
    assert.ok(notice < html.indexOf('<form id="register-form"'), `${page} : encart placé après le formulaire`)
  }
})
