const couchUrl = 'https://localfirst.backend.lol'
export const onRequest = async (context) => {
    const url = new URL(context.request.url)

    const headers = new Headers(context.request.headers)
    headers.set('Authorization', `Basic ${btoa('localfirst:localfirst')}`)

    const response = await fetch(couchUrl + url.pathname.replace('/_couch', '/'), {
        method: context.request.method,
        headers,
        body: context.request.body,
    })

    const newHeaders = new Headers(response.headers)
    newHeaders.set('Access-Control-Allow-Origin', 'http://localhost:5173, https://stackblitz.com')
    newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    return response
}
