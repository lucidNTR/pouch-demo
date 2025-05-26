const couchUrl = 'https://localfirst.backend.lol'
export const onRequest = async (context) => {
    const url = new URL(context.request.url)

    const headers = new Headers(context.request.headers)
    headers.set('Authorization', `Basic ${btoa('localfirst:localfirst')}`);

    return fetch(couchUrl + url.pathname.replace('/_couch', '/'), {
        method: context.request.method,
        headers,
        body: context.request.body,
    })
}
