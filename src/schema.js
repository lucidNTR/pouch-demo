import { type } from 'arktype'

const PouchDoc = type({
    _id: 'string',
    '_rev?': 'string',
    '_attachments?': 'object',
    '_deleted?': 'boolean',
    '_conflicts?': 'string[]',
    '_revs_info?': 'object[]',
    '+': 'ignore'
})

const Todo = type({
    '...': PouchDoc,
    text: '/^(?!.*forbidden).{1,249}$/',
    done: 'boolean',
    order: 'number',

    'archived?': 'boolean',
    'yjs?': 'boolean',
    '_attachments?': {
        yjs: {
            content_type: "'application/octet-stream'",
            'data?': 'Blob',
            'digest?': 'string',
            'length?': 'number.integer < 512000',
            'revpos?': 'number.integer',
            'stub?': 'boolean'
        }
    },
    '+': 'reject'
})

export { Todo, type }
