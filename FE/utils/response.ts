export function success(data: any, status = 200) {
    return new Response(JSON.stringify({ success: true, data }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

export function failure(error: any, status = 500) {
    return new Response(JSON.stringify({ success: false, error }), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}
