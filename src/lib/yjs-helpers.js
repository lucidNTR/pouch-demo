import * as yjs from 'yjs'

export { yjs }

export function updateCrdt(crdt, newText) {
    // Find the difference and apply minimal operations
    // normally you would instead use an editor component with crdt ops bindings instead of an input field
    const ytext = crdt.getText('text')
    const currentText = ytext.toString()

    if (currentText !== newText) {
        crdt.transact(() => {
            const minLength = Math.min(currentText.length, newText.length)
            let commonPrefix = 0
            while (
                commonPrefix < minLength &&
                currentText[commonPrefix] === newText[commonPrefix]
            ) {
                commonPrefix++
            }

            let commonSuffix = 0
            const maxSuffix = minLength - commonPrefix
            while (
                commonSuffix < maxSuffix &&
                currentText[currentText.length - 1 - commonSuffix] ===
                    newText[newText.length - 1 - commonSuffix]
            ) {
                commonSuffix++
            }

            const deleteStart = commonPrefix
            const deleteLength =
                currentText.length - commonPrefix - commonSuffix
            const insertText = newText.slice(
                commonPrefix,
                newText.length - commonSuffix
            )

            if (deleteLength > 0) {
                ytext.delete(deleteStart, deleteLength)
            }
            if (insertText.length > 0) {
                ytext.insert(deleteStart, insertText)
            }
        })
    }
}

export async function makeYjsDoc(attachment) {
    const arrayBuffer = await attachment.arrayBuffer()
    const newYDoc = new yjs.Doc()
    yjs.applyUpdate(newYDoc, new Uint8Array(arrayBuffer))
    return newYDoc
}
