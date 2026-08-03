import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// Écriture atomique : on écrit dans un fichier temporaire puis on le renomme
// à la place du fichier final. Un lecteur concurrent (serveur web, Apple
// Calendar) ne voit donc jamais un fichier tronqué ou à moitié écrit, et une
// exécution qui échoue en cours de route ne corrompt jamais le fichier déjà publié.
export async function writeAtomic(path, content) {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const tmpPath = `${path}.tmp-${process.pid}`

  try {
    await writeFile(tmpPath, content, 'utf8')
    await rename(tmpPath, path)
  } catch (error) {
    await unlink(tmpPath).catch(() => {})
    throw error
  }
}
